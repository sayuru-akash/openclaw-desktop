import type {
  AlwaysOnGatewayStatus,
  ChannelStatusItem,
  ChannelStatusResult,
  CommandResult,
  EnvironmentStatus,
  ManagedChannel,
  ModelStatusResult,
  WizardAnswer,
  WizardNextResult,
  WizardRunStatus,
  WizardStartParams,
  WizardStartResult,
  WizardStatusResult
} from "../../shared/types";
import { access, appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand, runCommandStreaming } from "./command-runner";
import {
  inferChannelStatusFromPayload,
  inferModelStatusFromPayload,
  isScheduledTaskMissing
} from "./parsers";

const ALWAYS_ON_TASK_NAME = "OpenClawDesktopAlwaysOnGateway";
const ALWAYS_ON_SYSTEMD_USER_SERVICE = "openclaw-gateway.service";
const WSL_REBOOT_EXIT_CODES = [3010, 1641];
const WSL_INSTALL_OK_EXIT_CODES = [...WSL_REBOOT_EXIT_CODES];
const WSL_INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const WSL_RUNTIME_INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const WSL_BREW_INSTALL_TIMEOUT_MS = 35 * 60 * 1000;
const OPENCLAW_INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const DISK_CHECK_TIMEOUT_MS = 20 * 1000;
const WSL_MIN_FREE_BYTES = 1024 * 1024 * 1024;
const OPENCLAW_MIN_FREE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_WSL_DISTRO = "Ubuntu";
const WSL_USER_SETUP_REQUIRED_MARKER = "WSL_USER_SETUP_REQUIRED";
const LINUXBREW_SYSTEM_PREFIX = "/home/linuxbrew/.linuxbrew";
const MIN_OPENCLAW_WSL_NODE_MAJOR = 20;
const WSL_RUNTIME_NODE_SOURCE_MAJOR = 22;

interface WslStatus {
  wslInstalled: boolean;
  accessDenied: boolean;
  distroInstalled: boolean;
  distroReachable: boolean;
  distro: string;
}

interface NodeRuntimeStatus {
  nodeInstalled: boolean;
  npmInstalled: boolean;
  nodeVersion: string | null;
}

export class EnvironmentService {
  private resolvedOpenClawCommand = "";

  public async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    const wslDistro = this.getPreferredWslDistro();
    const status: EnvironmentStatus = {
      checkedAt: new Date().toISOString(),
      platform: process.platform,
      isWindows: process.platform === "win32",
      wslInstalled: false,
      wslAccessDenied: false,
      wslDistro,
      wslDistroInstalled: false,
      wslReady: false,
      wslUserConfigured: false,
      nodeInstalled: false,
      npmInstalled: false,
      brewInstalled: false,
      openClawInstalled: false,
      gatewayRunning: false,
      gatewayStartingUp: false,
      notes: []
    };

    if (!status.isWindows) {
      status.notes.push("Setup checks are unavailable in this environment.");
      return status;
    }

    const wslStatus = await this.getWslStatus();
    status.wslInstalled = wslStatus.wslInstalled;
    status.wslAccessDenied = wslStatus.accessDenied;
    status.wslDistro = wslStatus.distro;
    status.wslDistroInstalled = wslStatus.distroInstalled;
    status.wslReady = wslStatus.wslInstalled && wslStatus.distroInstalled && wslStatus.distroReachable;

    if (!status.wslInstalled) {
      status.notes.push("WSL is not ready. Install WSL and Ubuntu first.");
      return status;
    }

    if (status.wslAccessDenied) {
      status.notes.push("WSL is installed but distro access is denied in this Windows session. Run OpenClaw Desktop with normal user permissions or fix WSL policy permissions.");
      return status;
    }

    if (!status.wslDistroInstalled) {
      status.notes.push(`WSL distro ${status.wslDistro} is not installed yet.`);
      return status;
    }

    if (!wslStatus.distroReachable) {
      status.notes.push(`WSL distro ${status.wslDistro} is registered but not reachable. Repair WSL and retry setup.`);
      return status;
    }

    status.wslUserConfigured = await this.isWslUserConfigured(status.wslDistro);
    if (!status.wslUserConfigured) {
      status.notes.push("Finish Ubuntu first-run account setup (username/password), then resume setup.");
      return status;
    }

    const runtime = await this.getNodeRuntimeStatus(status.wslDistro);
    status.nodeInstalled = runtime.nodeInstalled;
    status.npmInstalled = runtime.npmInstalled;

    if (!status.nodeInstalled || !status.npmInstalled) {
      status.notes.push("Runtime dependencies in WSL are not ready yet.");
      if (!status.nodeInstalled) {
        if (runtime.nodeVersion) {
          status.notes.push(`Node.js ${runtime.nodeVersion} is too old. OpenClaw requires Node.js ${MIN_OPENCLAW_WSL_NODE_MAJOR}+ in WSL.`);
        } else {
          status.notes.push("node command is missing in WSL.");
        }
      }
      if (!status.npmInstalled) {
        status.notes.push("npm command is missing in WSL.");
      }
      return status;
    }

    status.brewInstalled = await this.isBrewAvailableForSetup(status.wslDistro);
    if (!status.brewInstalled) {
      status.notes.push("Homebrew is missing in WSL.");
      return status;
    }

    status.openClawInstalled = await this.isOpenClawAvailable(status.wslDistro);
    if (!status.openClawInstalled) {
      status.notes.push("OpenClaw CLI not found in WSL.");
      return status;
    }

    const gatewayStatus = await this.gatewayStatus();
    const processRunning = gatewayStatus.ok && /running|active|ok/i.test(`${gatewayStatus.stdout} ${gatewayStatus.stderr}`);

    if (processRunning) {
      // The gateway process is running, but it takes 15-30s to initialize
      // and bind the WebSocket port. Verify the port is actually accepting
      // connections before declaring gatewayRunning = true, so the UI
      // doesn't show broken pages or let the user restart the gateway
      // mid-startup.
      const portReady = await this.isGatewayPortReady();
      status.gatewayRunning = portReady;
      if (!portReady) {
        status.gatewayStartingUp = true;
        status.notes.push("Gateway process is starting up — waiting for WebSocket port to become ready.");
      }
    } else {
      status.gatewayRunning = false;
      status.notes.push("Gateway is not running yet.");
    }

    return status;
  }

  public installNodeRuntime(): Promise<CommandResult> {
    return this.installNodeRuntimeInternal();
  }

  public installNodeRuntimeStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    return this.installNodeRuntimeInternal(onLog);
  }

  public async openWslUserSetup(): Promise<CommandResult> {
    if (process.platform !== "win32") {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "WSL user setup is only available on Windows."
      };
    }

    const wslStatus = await this.getWslStatus();
    const distro = wslStatus.distroInstalled ? wslStatus.distro : this.getPreferredWslDistro();
    const quotedDistro = this.quoteForSingleQuotedPowerShell(distro);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$process = Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', ${quotedDistro}) -PassThru`,
      "Write-Output ('Launched WSL setup process id: ' + $process.Id)",
      "exit 0"
    ].join("; ");

    return runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      timeoutMs: 15_000,
      env: this.buildCommandEnv()
    });
  }

  public restartComputer(): Promise<CommandResult> {
    if (process.platform !== "win32") {
      return Promise.resolve({
        ok: false,
        code: null,
        stdout: "",
        stderr: "Restart command is only available on Windows."
      });
    }

    return runCommand("shutdown.exe", ["/r", "/t", "0"], {
      timeoutMs: 15_000,
      env: this.buildCommandEnv()
    });
  }

  public installOpenClaw(): Promise<CommandResult> {
    return this.installOpenClawInternal();
  }

  public installOpenClawStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    return this.installOpenClawInternal(onLog);
  }

  public runOnboarding(): Promise<CommandResult> {
    return this.runOpenClaw(["onboard", "--install-daemon"]);
  }

  public runOnboardingStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    return this.runOpenClawStreaming(["onboard", "--install-daemon"], onLog);
  }

  public wizardStart(params: WizardStartParams = {}): Promise<WizardStartResult> {
    return this.runWizardCall<WizardStartResult>("wizard.start", params);
  }

  public wizardNext(sessionId: string, answer?: WizardAnswer): Promise<WizardNextResult> {
    const payload = answer ? { sessionId, answer } : { sessionId };
    return this.runWizardCall<WizardNextResult>("wizard.next", payload);
  }

  public wizardStatus(sessionId: string): Promise<WizardStatusResult> {
    return this.runWizardCall<WizardStatusResult>("wizard.status", { sessionId });
  }

  public wizardCancel(sessionId: string): Promise<{ status: WizardRunStatus; error?: string }> {
    return this.runWizardCall<{ status: WizardRunStatus; error?: string }>("wizard.cancel", { sessionId });
  }

  private gatewayCallQueue: Promise<unknown> = Promise.resolve();
  private cachedGatewayAuthToken: string | null = null;

  public gatewayCall<T>(method: string, params: unknown = {}): Promise<T> {
    // Serialize gateway calls so only one WebSocket connection is open at a time.
    const queued = this.gatewayCallQueue.then(
      () => this.gatewayCallSerialized<T>(method, params),
      () => this.gatewayCallSerialized<T>(method, params)
    );
    this.gatewayCallQueue = queued.catch(() => {});
    return queued;
  }

  private async gatewayCallSerialized<T>(method: string, params: unknown): Promise<T> {
    const payload = JSON.stringify(params);
    const maxAttempts = 5;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Resolve token inside the loop so cache-clearing on retry actually takes effect
      const token = await this.resolveGatewayAuthToken();
      const args = ["gateway", "call", method, "--params", payload, "--json"];
      if (token) {
        args.push("--token", token);
      }
      console.info("[gatewayCallSerialized]", { method, attempt, hasToken: !!token });

      const result = await this.runOpenClaw(args);

      if (!result.ok) {
        const errorText = result.stderr || result.stdout || `${method} failed`;
        const isTransient = /1006|abnormal closure|ECONNREFUSED|ECONNRESET|EPIPE|gateway closed/i.test(errorText);
        lastError = new Error(`Gateway call '${method}' failed: ${errorText}`);
        console.warn("[gatewayCallSerialized]", { method, attempt, isTransient, errorText: errorText.slice(0, 200) });

        if (isTransient && attempt < maxAttempts) {
          // Token may have changed; clear cache before retry.
          // Use escalating delays: 2s, 4s, 6s, 8s to give the gateway time to finish starting.
          this.cachedGatewayAuthToken = null;
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        throw lastError;
      }

      const parsed = this.parseJsonOutput(result.stdout, result.stderr);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const errorValue = (parsed as { error?: unknown }).error;
        if (errorValue) {
          throw new Error(typeof errorValue === "string" ? errorValue : JSON.stringify(errorValue));
        }
      }

      if (parsed && typeof parsed === "object" && "result" in parsed) {
        return (parsed as { result: T }).result;
      }

      return parsed as T;
    }

    throw lastError ?? new Error(`Gateway call '${method}' failed after ${maxAttempts} attempts`);
  }

  /**
   * Reads the gateway auth token from ~/.openclaw/openclaw.json inside WSL.
   * The gateway may require token auth (gateway.auth.mode === "token").
   * Caches the result to avoid reading the config on every call.
   *
   * Reads the raw JSON via `wsl.exe cat` and parses it in-process (Node.js)
   * so we don't depend on any WSL-side tools being in PATH.
   */
  private async resolveGatewayAuthToken(): Promise<string | null> {
    if (this.cachedGatewayAuthToken !== null) {
      console.info("[resolveGatewayAuthToken] using cached token, hasToken:", !!this.cachedGatewayAuthToken);
      return this.cachedGatewayAuthToken || null;
    }

    try {
      let configJson = "";
      if (process.platform === "win32") {
        const wslStatus = await this.getWslStatus();
        console.info("[resolveGatewayAuthToken] wslStatus:", {
          wslInstalled: wslStatus.wslInstalled,
          distroInstalled: wslStatus.distroInstalled,
          distroReachable: wslStatus.distroReachable,
          distro: wslStatus.distro
        });
        if (wslStatus.wslInstalled && wslStatus.distroInstalled && wslStatus.distroReachable) {
          const brewUser = await this.resolveWslBrewUser(wslStatus.distro) || "root";
          const configPath = "/home/" + brewUser + "/.openclaw/openclaw.json";
          console.info("[resolveGatewayAuthToken] reading config:", { brewUser, configPath });
          const result = await runCommand("wsl.exe", [
            "-d", wslStatus.distro, "--", "cat", configPath
          ], { timeoutMs: 10_000, env: this.buildCommandEnv() });
          console.info("[resolveGatewayAuthToken] cat result:", {
            ok: result.ok,
            stdoutLen: result.stdout?.length ?? 0,
            stderrLen: result.stderr?.length ?? 0,
            stderr: (result.stderr || "").slice(0, 200)
          });
          configJson = result.ok ? result.stdout : "";
        }
      } else {
        const homedir = os.homedir();
        const configPath = path.join(homedir, ".openclaw", "openclaw.json");
        try {
          const { readFile } = await import("node:fs/promises");
          configJson = await readFile(configPath, "utf8");
        } catch {
          configJson = "";
        }
      }

      if (configJson) {
        const config = JSON.parse(configJson) as { gateway?: { auth?: { token?: string } } };
        const token = config?.gateway?.auth?.token?.trim() || "";
        console.info("[resolveGatewayAuthToken] parsed token:", { hasToken: !!token, tokenLen: token.length });
        this.cachedGatewayAuthToken = token;
        return token || null;
      }
      console.warn("[resolveGatewayAuthToken] no config JSON obtained");
    } catch (err) {
      console.error("[resolveGatewayAuthToken] error:", err instanceof Error ? err.message : String(err));
    }

    this.cachedGatewayAuthToken = "";
    return null;
  }

  public gatewayStatus(): Promise<CommandResult> {
    return this.runOpenClaw(["gateway", "status"]);
  }

  /**
   * Checks whether the gateway's WebSocket port (18789) is accepting TCP
   * connections inside WSL. The gateway process can be "running" for 15-30s
   * before the port is actually ready, so this prevents premature RPC attempts
   * and avoids the "Start Gateway" button appearing during startup.
   */
  private async isGatewayPortReady(port = 18789): Promise<boolean> {
    if (process.platform === "win32") {
      const wslStatus = await this.getWslStatus();
      if (!wslStatus.wslInstalled || !wslStatus.distroInstalled || !wslStatus.distroReachable) {
        return false;
      }
      const result = await runCommand("wsl.exe", [
        "-d", wslStatus.distro, "--", "bash", "-c",
        `nc -z -w 2 127.0.0.1 ${port} 2>/dev/null && echo PORT_OPEN || echo PORT_CLOSED`
      ], { timeoutMs: 8_000, env: this.buildCommandEnv() });
      const output = (result.stdout || "").trim();
      console.info("[isGatewayPortReady]", { ok: result.ok, output: output.slice(0, 50) });
      return result.ok && output.includes("PORT_OPEN");
    }
    // On non-Windows, do a direct TCP connect
    try {
      const net = await import("node:net");
      return await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 3000);
        socket.connect(port, "127.0.0.1", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
        socket.on("error", () => { clearTimeout(timer); socket.destroy(); resolve(false); });
      });
    } catch {
      return false;
    }
  }

  public async gatewayStart(): Promise<CommandResult> {
    await this.ensureGatewayModeLocal();
    return this.runOpenClaw(["gateway", "start"]);
  }

  public async gatewayStartStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    await this.ensureGatewayModeLocal();
    return this.runOpenClawStreaming(["gateway", "start"], onLog);
  }

  /**
   * Ensures gateway.mode is set to "local" in the openclaw config.
   * Without this, the gateway refuses to start with:
   * "Gateway start blocked: set gateway.mode=local"
   */
  private async ensureGatewayModeLocal(): Promise<void> {
    const script = [
      "CONFIG=\"$HOME/.openclaw/openclaw.json\"",
      "if [ ! -f \"$CONFIG\" ]; then exit 0; fi",
      "node -e \"" +
        "const fs=require('fs');" +
        "const p=process.argv[1];" +
        "try{const c=JSON.parse(fs.readFileSync(p,'utf8'));" +
        "if(c.gateway&&c.gateway.mode==='local'){process.exit(0)}" +
        "if(!c.gateway)c.gateway={};" +
        "c.gateway.mode='local';" +
        "fs.writeFileSync(p,JSON.stringify(c,null,2)+'\\n');" +
        "console.log('Set gateway.mode=local')}" +
        "catch(e){console.error(e.message)}\" \"$CONFIG\""
    ].join("; ");

    if (process.platform === "win32") {
      const wslStatus = await this.getWslStatus();
      if (wslStatus.wslInstalled && wslStatus.distroInstalled && wslStatus.distroReachable) {
        const cliUser = await this.resolveWslBrewUser(wslStatus.distro);
        await this.runWslBash(wslStatus.distro, script, 15_000, cliUser || undefined);
        return;
      }
    }

    await runCommand("bash", ["-c", script], { env: this.buildCommandEnv() });
  }

  public gatewayStop(): Promise<CommandResult> {
    return this.runOpenClaw(["gateway", "stop"]);
  }

  public async getChannelStatuses(): Promise<ChannelStatusResult> {
    const whatsapp = await this.readChannelStatus("whatsapp");
    const telegram = await this.readChannelStatus("telegram");
    return {
      checkedAt: new Date().toISOString(),
      channels: [whatsapp, telegram]
    };
  }

  public async reconnectChannel(channel: ManagedChannel): Promise<ChannelStatusItem> {
    const args = channel === "whatsapp"
      ? ["channels", "login", "--channel", "whatsapp"]
      : ["channels", "login", "--channel", "telegram"];

    const result = await this.runOpenClaw(args);
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || `Failed to reconnect ${channel}.`);
    }

    return this.readChannelStatus(channel);
  }

  public async disableChannel(channel: ManagedChannel): Promise<ChannelStatusItem> {
    const commandArgs = [
      ["channels", "logout", "--channel", channel],
      ["channels", "remove", "--channel", channel, "--delete"],
      ["channels", "remove", "--channel", channel]
    ];

    let lastError = "";
    for (const args of commandArgs) {
      const result = await this.runOpenClaw(args);
      if (result.ok) {
        return this.readChannelStatus(channel);
      }
      lastError = result.stderr || result.stdout || lastError;
    }

    throw new Error(lastError || `Unable to disable ${channel} channel.`);
  }

  public async configureTelegramBot(token: string): Promise<ChannelStatusItem> {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      throw new Error("Telegram bot token is required.");
    }

    const commandArgs = [
      ["channels", "add", "--channel", "telegram", "--token", normalizedToken],
      ["channels", "login", "--channel", "telegram", "--token", normalizedToken]
    ];

    let lastError = "";
    for (const args of commandArgs) {
      const result = await this.runOpenClaw(args);
      if (result.ok) {
        return this.readChannelStatus("telegram");
      }
      lastError = result.stderr || result.stdout || lastError;
    }

    throw new Error(lastError || "Unable to configure Telegram bot token.");
  }

  public async getModelStatus(): Promise<ModelStatusResult> {
    const result = await this.runOpenClaw(["models", "list", "--all", "--json"]);
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Unable to load model status.");
    }

    const payload = this.parseJsonOutput(result.stdout, result.stderr);
    const inferred = inferModelStatusFromPayload(payload);
    return {
      checkedAt: new Date().toISOString(),
      provider: inferred.provider,
      model: inferred.model,
      availableProviders: inferred.availableProviders,
      modelsByProvider: inferred.modelsByProvider,
      modelDisplayNames: inferred.modelDisplayNames,
      detail: inferred.detail
    };
  }

  public async saveModelApiKey(provider: string, apiKey: string): Promise<CommandResult> {
    const normalizedProvider = provider.trim();
    const normalizedKey = apiKey.trim();

    if (!normalizedProvider || !normalizedKey) {
      throw new Error("Provider and API key are required.");
    }

    // The CLI's paste-token command uses an interactive TUI prompt that cannot
    // be driven non-interactively. Instead, write auth profiles directly.
    // Save both the exact provider and a normalized slug alias to cover
    // provider IDs such as "kimi-coding" when UIs expose "Kimi Coding".
    const canonicalProvider = normalizedProvider
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const providerAliases = Array.from(
      new Set([normalizedProvider, canonicalProvider].filter((value) => value.length > 0))
    );
    const jsonPayload = JSON.stringify({
      providers: providerAliases,
      key: normalizedKey
    });

    const quotedPayload = this.quoteForBash(jsonPayload);
    const resolveAndWrite = [
      this.buildBrewShellenvBootstrapCommand(),
      "export PATH=\"$HOME/.openclaw-desktop/npm/bin:$PATH\"",
      // Resolve status payload once; includes auth store metadata in newer CLI versions.
      "export STATUS_JSON=\"$(openclaw models status --json 2>/dev/null)\"",
      "if [ -z \"$STATUS_JSON\" ]; then echo \"Could not resolve model status payload.\" >&2; exit 1; fi",
      // Read existing file(s) or start with empty array, then upsert profile aliases.
      // This writes to the discovered auth store, plus conservative fallback paths
      // for agent-scoped and legacy/global stores.
      `node -e "
        const fs = require('fs');
        const path = require('path');
        const statusJson = process.env.STATUS_JSON || '';
        const payload = ${quotedPayload};
        const providers = Array.isArray(payload.providers) ? payload.providers : [];
        const home = process.env.HOME || '';
        let status = {};
        try { status = JSON.parse(statusJson); } catch {}

        const stores = new Set();
        const addStore = (value) => {
          if (typeof value !== 'string' || !value.trim()) return;
          stores.add(value.trim());
        };

        addStore(status?.auth?.storePath);
        addStore(status?.auth?.store?.path);
        addStore(status?.storePath);

        const agentDir = status?.agentDir || status?.agent?.dir || status?.auth?.agentDir;
        if (typeof agentDir === 'string' && agentDir.trim()) {
          addStore(path.posix.join(agentDir.trim(), 'auth-profiles.json'));
        }

        if (home) {
          addStore(path.posix.join(home, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json'));
          addStore(path.posix.join(home, '.openclaw', 'auth-profiles.json'));
        }

        if (stores.size === 0) {
          console.error('Could not resolve any auth store paths.');
          process.exit(1);
        }

        const toProfileId = (provider) => provider + ':manual';
        const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
        const normalizeEntry = (entry) => {
          if (!isObject(entry)) return null;
          const provider = typeof entry.provider === 'string' ? entry.provider.trim() : '';
          if (!provider) return null;
          const rawType = typeof entry.type === 'string' ? entry.type.trim() : '';
          const type = rawType === 'api-key' ? 'api_key' : rawType || (typeof entry.token === 'string' || typeof entry.key === 'string' ? 'api_key' : '');
          if (!type) return null;
          const credential = { ...entry, type };
          if (type === 'api_key') {
            if (typeof credential.key !== 'string' && typeof credential.token === 'string') {
              credential.key = credential.token;
            }
            delete credential.token;
          }
          return [toProfileId(provider), credential];
        };

        let totalUpserts = 0;
        for (const storePath of stores) {
          fs.mkdirSync(path.posix.dirname(storePath), { recursive: true });
          let parsed = null;
          try { parsed = JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch {}

          const store = isObject(parsed) ? parsed : {};
          const profiles = isObject(store.profiles) ? { ...store.profiles } : {};

          // Migrate legacy/invalid array format into map format expected by OpenClaw.
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const normalized = normalizeEntry(item);
              if (!normalized) continue;
              const [id, credential] = normalized;
              profiles[id] = credential;
            }
          }

          for (const provider of providers) {
            profiles[toProfileId(provider)] = {
              provider,
              type: 'api_key',
              key: payload.key
            };
            totalUpserts += 1;
          }

          const normalizedStore = {
            version: Number(store.version || 1) || 1,
            profiles
          };
          if (isObject(store.order)) normalizedStore.order = store.order;
          if (isObject(store.lastGood)) normalizedStore.lastGood = store.lastGood;
          if (isObject(store.usageStats)) normalizedStore.usageStats = store.usageStats;

          fs.writeFileSync(storePath, JSON.stringify(normalizedStore, null, 2) + '\\n');
          console.log('Saved auth profiles in: ' + storePath);
        }
        console.log('Provider aliases: ' + providers.join(', ') + '; upserts: ' + totalUpserts);
      "`
    ].join("; ");

    if (process.platform === "win32") {
      const wslStatus = await this.getWslStatus();
      if (wslStatus.wslInstalled && wslStatus.distroInstalled && wslStatus.distroReachable) {
        const cliUser = await this.resolveWslBrewUser(wslStatus.distro);
        return this.runWslBash(wslStatus.distro, resolveAndWrite, OPENCLAW_INSTALL_TIMEOUT_MS, cliUser || undefined);
      }
    }

    // Non-WSL fallback
    return runCommand("bash", ["-c", resolveAndWrite], { env: this.buildCommandEnv() });
  }

  public async applyModelSelection(provider: string, model: string): Promise<ModelStatusResult> {
    const normalizedModel = model.trim();

    if (!normalizedModel) {
      throw new Error("Provider and model are required.");
    }

    // CLI expects: openclaw models set <model-key>
    // The model key already includes the provider (e.g. "anthropic/claude-opus-4-6")
    const result = await this.runOpenClaw([
      "models",
      "set",
      normalizedModel
    ]);

    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Unable to apply model selection.");
    }

    return this.getModelStatus();
  }

  public async getAlwaysOnGatewayStatus(): Promise<AlwaysOnGatewayStatus> {
    if (process.platform !== "win32") {
      return {
        supported: false,
        enabled: false,
        taskName: ALWAYS_ON_TASK_NAME,
        detail: "Always-on gateway uses Windows Task Scheduler and is only available on Windows."
      };
    }
    const systemdStatus = await this.getSystemdAlwaysOnStatus();
    const scheduledTaskStatus = await this.getScheduledTaskAlwaysOnStatus();

    if (systemdStatus.supported && systemdStatus.enabled) {
      return {
        supported: true,
        enabled: true,
        taskName: ALWAYS_ON_TASK_NAME,
        detail: "Enabled via WSL systemd user service."
      };
    }

    if (scheduledTaskStatus.enabled) {
      return scheduledTaskStatus;
    }

    if (systemdStatus.supported) {
      return {
        supported: true,
        enabled: false,
        taskName: ALWAYS_ON_TASK_NAME,
        detail: `Disabled. ${systemdStatus.detail}`
      };
    }

    return scheduledTaskStatus;
  }

  public async setAlwaysOnGatewayEnabled(enabled: boolean): Promise<AlwaysOnGatewayStatus> {
    if (process.platform !== "win32") {
      throw new Error("Always-on gateway is supported only on Windows.");
    }

    if (enabled) {
      const systemdEnable = await this.enableSystemdAlwaysOn();
      if (!systemdEnable.ok) {
        await this.enableScheduledTaskAlwaysOn();
      }
      void this.gatewayStart();
      return this.getAlwaysOnGatewayStatus();
    }

    await this.disableSystemdAlwaysOn();
    await this.disableScheduledTaskAlwaysOn();
    return this.getAlwaysOnGatewayStatus();
  }

  public rebootRequired(result: CommandResult): boolean {
    if (result.code !== null && WSL_REBOOT_EXIT_CODES.includes(result.code)) {
      return true;
    }

    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return /(reboot|restart|reiniciar|red[eé]marr|neu\s*start|riavvia|перезагруз|再起動|重启)/i.test(output);
  }

  private async installNodeRuntimeInternal(
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    if (process.platform !== "win32") {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "WSL setup is only available on Windows."
      };
    }

    const diskCheck = await this.ensureMinimumFreeSpace(
      process.env.SystemDrive ? `${process.env.SystemDrive}\\` : "C:\\",
      WSL_MIN_FREE_BYTES,
      onLog
    );
    if (diskCheck) {
      return diskCheck;
    }

    const wslStatus = await this.getWslStatus();
    const distro = wslStatus.distro;
    let lastResult: CommandResult | null = null;

    if (wslStatus.accessDenied) {
      onLog?.("WSL distro access is denied in this Windows session (E_ACCESSDENIED).", "stderr");
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Wsl/EnumerateDistros/Service/E_ACCESSDENIED: Windows blocked WSL distro access for this session. Run OpenClaw Desktop in your normal user session, verify `wsl -l -v` works, then retry setup."
      };
    }

    if (!wslStatus.wslInstalled || !wslStatus.distroInstalled) {
      onLog?.(`Installing WSL and distro ${distro} on Windows...`, "stdout");
      const wslInstall = await this.installWslWithPowerShell(distro, onLog);
      lastResult = wslInstall;
      if (!wslInstall.ok) {
        const detail = [wslInstall.stderr, wslInstall.stdout].filter(Boolean).join("\n").trim();
        return {
          ...wslInstall,
          stderr: `${detail}\n${this.detectWslInstallFailureHint(detail)}`.trim()
        };
      }

      const postWslStatus = await this.getWslStatus();
      if (!postWslStatus.wslInstalled || !postWslStatus.distroInstalled || !postWslStatus.distroReachable) {
        const requiresRestart = this.rebootRequired(wslInstall);
        return {
          ok: false,
          code: wslInstall.code,
          stdout: wslInstall.stdout,
          stderr: requiresRestart
            ? "WSL installation requested a restart. Restart Windows, open OpenClaw Desktop, and continue setup."
            : `WSL install finished but ${distro} is still unavailable. Retry setup after restarting Windows.`
        };
      }
    } else if (!wslStatus.distroReachable) {
      onLog?.(`WSL distro ${distro} is installed but not reachable. Restarting WSL service...`, "stderr");
      await runCommand("wsl.exe", ["--shutdown"], {
        okExitCodes: [0, 1],
        timeoutMs: 20_000,
        env: this.buildCommandEnv()
      });
      const retryStatus = await this.getWslStatus();
      if (!retryStatus.distroReachable) {
        return {
          ok: false,
          code: null,
          stdout: "",
          stderr: `WSL distro ${distro} is registered but cannot be launched. Reinstall/repair WSL and retry setup.`
        };
      }
    }

    const wslUserConfigured = await this.isWslUserConfigured(distro);
    if (!wslUserConfigured) {
      onLog?.("Ubuntu account setup is required (username/password).", "stderr");
      onLog?.("Open Ubuntu setup, finish account creation, then click Resume Setup.", "stderr");
      return {
        ok: false,
        code: 1001,
        stdout: "",
        stderr: `${WSL_USER_SETUP_REQUIRED_MARKER}: Ubuntu account setup is required. Open Ubuntu and finish username/password first.`
      };
    }

    const runtime = await this.getNodeRuntimeStatus(distro);
    if (!runtime.nodeInstalled || !runtime.npmInstalled) {
      if (runtime.nodeVersion && !runtime.nodeInstalled) {
        onLog?.(
          `Detected Node.js ${runtime.nodeVersion} in WSL, but OpenClaw requires Node.js ${MIN_OPENCLAW_WSL_NODE_MAJOR}+. Upgrading Node.js...`,
          "stdout"
        );
      }
      onLog?.(`Installing runtime dependencies in WSL distro ${distro}...`, "stdout");
      const runtimeInstall = await this.installWslRuntimeDependencies(distro, onLog);
      lastResult = runtimeInstall;
      if (!runtimeInstall.ok) {
        const detail = [runtimeInstall.stderr, runtimeInstall.stdout].filter(Boolean).join("\n").trim();
        return {
          ...runtimeInstall,
          stderr: `${detail}\n${this.detectRuntimeInstallFailureHint(detail)}`.trim()
        };
      }
    }

    const finalRuntime = await this.getNodeRuntimeStatus(distro);
    if (!finalRuntime.nodeInstalled || !finalRuntime.npmInstalled) {
      const versionHint = finalRuntime.nodeVersion
        ? ` Detected Node.js ${finalRuntime.nodeVersion}; OpenClaw requires Node.js ${MIN_OPENCLAW_WSL_NODE_MAJOR}+ in WSL.`
        : "";
      return {
        ok: false,
        code: lastResult?.code ?? null,
        stdout: lastResult?.stdout ?? "",
        stderr: `WSL runtime install finished but Node.js >=${MIN_OPENCLAW_WSL_NODE_MAJOR} and npm are still unavailable.${versionHint} Open Ubuntu once, then retry setup.`
      };
    }

    const brewInstalled = await this.isBrewAvailableForSetup(distro);
    if (!brewInstalled) {
      const brewLog = async (msg: string) => {
        const logDir = path.join(os.homedir(), ".openclaw-desktop");
        await mkdir(logDir, { recursive: true }).catch(() => {});
        await appendFile(path.join(logDir, "brew-install.log"), `[${new Date().toISOString()}] ${msg}\n`).catch(() => {});
      };

      await brewLog("=== Homebrew install started ===");
      onLog?.(`Ensuring Homebrew system dependencies in WSL distro ${distro}...`, "stdout");
      const brewDepsInstall = await this.installWslBrewDependencies(distro, onLog);
      await brewLog(`brewDepsInstall ok=${brewDepsInstall.ok} code=${brewDepsInstall.code}\nstdout: ${brewDepsInstall.stdout}\nstderr: ${brewDepsInstall.stderr}`);
      if (!brewDepsInstall.ok) {
        const detail = [brewDepsInstall.stderr, brewDepsInstall.stdout].filter(Boolean).join("\n").trim();
        return {
          ...brewDepsInstall,
          stderr: `${detail}\n${this.detectRuntimeInstallFailureHint(detail)}`.trim()
        };
      }

      onLog?.(`Installing Homebrew in WSL distro ${distro}...`, "stdout");
      const brewInstall = await this.installWslBrew(distro, onLog);
      await brewLog(`brewInstall ok=${brewInstall.ok} code=${brewInstall.code}\nstdout: ${brewInstall.stdout}\nstderr: ${brewInstall.stderr}`);
      lastResult = brewInstall;
      if (!brewInstall.ok) {
        const detail = [brewInstall.stderr, brewInstall.stdout].filter(Boolean).join("\n").trim();
        return {
          ...brewInstall,
          stderr: `${detail}\n${this.detectBrewInstallFailureHint(detail)}`.trim()
        };
      }
    }

    const finalBrewInstalled = await this.isBrewAvailableForSetup(distro);
    if (!finalBrewInstalled) {
      return {
        ok: false,
        code: lastResult?.code ?? null,
        stdout: lastResult?.stdout ?? "",
        stderr: "Runtime install finished but Homebrew is still unavailable in WSL. Open Ubuntu once and retry setup."
      };
    }

    onLog?.(`WSL runtime is ready in distro ${distro} (Node, npm, Homebrew).`, "stdout");
    return lastResult ?? {
      ok: true,
      code: 0,
      stdout: `WSL runtime already installed in distro ${distro} (Node, npm, Homebrew).`,
      stderr: ""
    };
  }

  private async installOpenClawInternal(
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    if (process.platform !== "win32") {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "OpenClaw setup is only available on Windows."
      };
    }

    const wslStatus = await this.getWslStatus();
    if (!wslStatus.wslInstalled || !wslStatus.distroInstalled || !wslStatus.distroReachable) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "WSL is not ready. Install/repair WSL first."
      };
    }

    const distro = wslStatus.distro;
    const wslUserConfigured = await this.isWslUserConfigured(distro);
    if (!wslUserConfigured) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Ubuntu account setup is incomplete. Open Ubuntu and finish username/password setup first."
      };
    }

    const runtime = await this.getNodeRuntimeStatus(distro);
    if (!runtime.nodeInstalled || !runtime.npmInstalled) {
      const detail = runtime.nodeVersion
        ? `Detected Node.js ${runtime.nodeVersion}, but OpenClaw requires Node.js ${MIN_OPENCLAW_WSL_NODE_MAJOR}+ in WSL. `
        : "";
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: `${detail}Runtime dependencies are missing in WSL. Install WSL runtime first.`
      };
    }

    const brewInstalled = await this.isBrewAvailableForSetup(distro);
    if (!brewInstalled) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Homebrew is missing in WSL. Install WSL runtime first."
      };
    }

    const diskCheck = await this.ensureMinimumFreeSpace(
      process.env.SystemDrive ? `${process.env.SystemDrive}\\` : "C:\\",
      OPENCLAW_MIN_FREE_BYTES,
      onLog
    );
    if (diskCheck) {
      return diskCheck;
    }

    onLog?.(`Installing OpenClaw in WSL distro ${distro}...`, "stdout");
    const installUser = await this.resolveWslBrewUser(distro);
    if (installUser) {
      onLog?.(`Using Ubuntu user ${installUser} for OpenClaw install.`, "stdout");
    }

    const installScript = [
      "set -e",
      "echo \"WSL user: $(id -un)\"",
      "if command -v node >/dev/null 2>&1; then echo \"node: $(node --version)\"; elif command -v nodejs >/dev/null 2>&1; then echo \"nodejs: $(nodejs --version)\"; else echo \"node: missing\"; fi",
      "if command -v npm >/dev/null 2>&1; then echo \"npm: $(npm --version)\"; else echo \"npm: missing\"; fi",
      "mkdir -p \"$HOME/.openclaw-desktop/npm\"",
      "npm install -g openclaw --prefix \"$HOME/.openclaw-desktop/npm\" --no-fund --no-audit",
      "if [ ! -x \"$HOME/.openclaw-desktop/npm/bin/openclaw\" ]; then echo \"openclaw binary missing after npm install\" >&2; exit 1; fi",
      "\"$HOME/.openclaw-desktop/npm/bin/openclaw\" --version"
    ].join(" && ");

    const result = onLog
      ? await this.runWslBashStreaming(distro, installScript, onLog, OPENCLAW_INSTALL_TIMEOUT_MS, installUser || undefined)
      : await this.runWslBash(distro, installScript, OPENCLAW_INSTALL_TIMEOUT_MS, installUser || undefined);

    if (!result.ok) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      return {
        ...result,
        stderr: `${detail}\n${this.detectOpenClawInstallFailureHint(detail)}`.trim()
      };
    }

    const openclawInstalled = await this.isOpenClawAvailable(distro, true);
    if (!openclawInstalled) {
      return {
        ok: false,
        code: result.code,
        stdout: result.stdout,
        stderr: `${result.stderr}\nOpenClaw install finished but executable was not detected in WSL PATH.`.trim()
      };
    }

    return result;
  }

  private detectOpenClawInstallFailureHint(output: string): string {
    const blob = output.toLowerCase();
    if (/eai_again|enotfound|timed out|timeout|could not resolve|failed to connect|network/.test(blob)) {
      return "OpenClaw npm install in WSL failed due to network/registry access issues.";
    }
    if (/unsupported engine|notsup|requires node|ebadengine/.test(blob)) {
      return "OpenClaw npm install failed because the WSL Node.js version is too old for this package.";
    }
    if (/eacces|permission denied|operation not permitted/.test(blob)) {
      return "OpenClaw npm install failed due to filesystem permissions in WSL.";
    }
    if (/404|not found|no matching version/.test(blob)) {
      return "OpenClaw npm package could not be resolved from the configured registry.";
    }
    return "OpenClaw npm install in WSL failed. Check npm output and WSL health, then retry.";
  }

  private async installWslWithPowerShell(
    distro: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const quotedDistro = this.quoteForSingleQuotedPowerShell(distro);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `Write-Output ('Installing WSL distro ' + ${quotedDistro} + ' (UAC prompt may appear)...')`,
      `$process = Start-Process -FilePath 'wsl.exe' -ArgumentList @('--install','-d',${quotedDistro},'--no-launch') -Verb RunAs -PassThru -Wait`,
      "Write-Output ('wsl.exe exit code: ' + $process.ExitCode)",
      "exit $process.ExitCode"
    ].join("; ");

    if (!onLog) {
      return runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
        okExitCodes: WSL_INSTALL_OK_EXIT_CODES,
        timeoutMs: WSL_INSTALL_TIMEOUT_MS,
        env: this.buildCommandEnv()
      });
    }

    return runCommandStreaming(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        okExitCodes: WSL_INSTALL_OK_EXIT_CODES,
        timeoutMs: WSL_INSTALL_TIMEOUT_MS,
        env: this.buildCommandEnv(),
        onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
        onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
      }
    );
  }

  private async installWslRuntimeDependencies(
    distro: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const script = [
      "set -e",
      "export DEBIAN_FRONTEND=noninteractive",
      // Recover from interrupted apt/dpkg transactions before package install.
      "if ! dpkg --configure -a; then apt-get -f install -y; dpkg --configure -a; fi",
      "apt-get update",
      "apt-get install -y ca-certificates curl gnupg file git build-essential procps",
      "install -m 0755 -d /etc/apt/keyrings",
      "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg",
      "chmod a+r /etc/apt/keyrings/nodesource.gpg",
      `echo \"deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${WSL_RUNTIME_NODE_SOURCE_MAJOR}.x nodistro main\" > /etc/apt/sources.list.d/nodesource.list`,
      "apt-get update",
      "apt-get install -y nodejs",
      "if ! command -v npm >/dev/null 2>&1; then apt-get install -y npm; fi",
      "if ! command -v node >/dev/null 2>&1 && command -v nodejs >/dev/null 2>&1; then ln -sf \"$(command -v nodejs)\" /usr/local/bin/node || true; fi"
    ].join(" && ");
    return onLog
      ? this.runWslBashStreaming(distro, script, onLog, WSL_RUNTIME_INSTALL_TIMEOUT_MS, "root")
      : this.runWslBash(distro, script, WSL_RUNTIME_INSTALL_TIMEOUT_MS, "root");
  }

  private detectWslInstallFailureHint(output: string): string {
    const blob = output.toLowerCase();
    if (/cancel|1602|1223/.test(blob)) {
      return "WSL install was cancelled. Accept the UAC prompt and retry.";
    }
    if (/restart|reboot|3010|1641/.test(blob)) {
      return "Windows restart is required. Restart the PC, then continue onboarding.";
    }
    if (/virtual machine platform|hyper-v|required feature/i.test(blob)) {
      return "Required virtualization features are missing. Enable virtualization in BIOS and retry.";
    }
    if (/no-launch|invalid command line option|unknown option/.test(blob)) {
      return "Your WSL version does not support --no-launch. Update WSL (`wsl --update`) and retry setup.";
    }
    if (/access is denied|permission|administrator|policy/.test(blob)) {
      return "Permissions blocked WSL install. Run with admin rights or contact IT admin.";
    }
    return "Retry WSL install. If it keeps failing, install WSL manually (`wsl --install -d Ubuntu`) and reopen the app.";
  }

  private detectRuntimeInstallFailureHint(output: string): string {
    const blob = output.toLowerCase();
    if (/temporary failure resolving|could not resolve|network|timed out|timeout/.test(blob)) {
      return "Network issue detected while installing runtime packages in WSL.";
    }
    if (/nodesource|deb\.nodesource\.com|keyring|gpg: no valid openpgp data found/.test(blob)) {
      return "Node.js repository bootstrap failed in WSL. Check outbound HTTPS access to deb.nodesource.com and retry.";
    }
    if (/dpkg was interrupted|apt --fix-broken/.test(blob)) {
      return "WSL package manager is in a broken state. Open Ubuntu and run: sudo dpkg --configure -a && sudo apt-get -f install -y, then retry setup.";
    }
    return "Runtime install in WSL failed. Open Ubuntu once to finish distro initialization, then retry.";
  }

  private detectBrewInstallFailureHint(output: string): string {
    const blob = output.toLowerCase();
    if (/network|timed out|timeout|could not resolve|failed to connect/.test(blob)) {
      return "Network issue detected while installing Homebrew in WSL.";
    }
    if (/sudo|permission denied|operation not permitted|not writable/.test(blob)) {
      return "Homebrew installer was blocked by permissions. Automatic ownership repair was attempted; click Install Homebrew to retry.";
    }
    return "Homebrew install in WSL failed. Retry Install Homebrew and check WSL logs for details if it keeps failing.";
  }

  private async getWslStatus(): Promise<WslStatus> {
    const preferredDistro = this.getPreferredWslDistro();

    if (process.platform !== "win32") {
      return { wslInstalled: false, accessDenied: false, distroInstalled: false, distroReachable: false, distro: preferredDistro };
    }

    const list = await runCommand("wsl.exe", ["-l", "-q"], {
      okExitCodes: [1],
      timeoutMs: 20_000,
      env: this.buildCommandEnv()
    });

    const merged = this.normalizeWslOutput(`${list.stdout}\n${list.stderr}`).toLowerCase();
    if (this.isWslCommandMissingOutput(merged)) {
      return { wslInstalled: false, accessDenied: false, distroInstalled: false, distroReachable: false, distro: preferredDistro };
    }

    if (this.isWslFeatureDisabledOutput(merged)) {
      return { wslInstalled: false, accessDenied: false, distroInstalled: false, distroReachable: false, distro: preferredDistro };
    }

    if (this.isWslAccessDeniedOutput(merged)) {
      return { wslInstalled: true, accessDenied: true, distroInstalled: false, distroReachable: false, distro: preferredDistro };
    }

    const distributions = list.stdout
      .split(/\r?\n/)
      .map((line) => this.normalizeWslOutput(line).trim())
      .filter(Boolean);

    if (distributions.length === 0 && this.isNoInstalledDistrosOutput(merged)) {
      return { wslInstalled: true, accessDenied: false, distroInstalled: false, distroReachable: false, distro: preferredDistro };
    }

    const resolvedDistro = this.resolveInstalledDistro(preferredDistro, distributions);
    if (!resolvedDistro) {
      return { wslInstalled: true, accessDenied: false, distroInstalled: false, distroReachable: false, distro: preferredDistro };
    }

    const distroReachable = await this.canLaunchWslDistroAsRoot(resolvedDistro);
    return { wslInstalled: true, accessDenied: false, distroInstalled: true, distroReachable, distro: resolvedDistro };
  }

  private resolveInstalledDistro(preferredDistro: string, installedDistros: string[]): string | null {
    const preferred = preferredDistro.trim();
    const exact = installedDistros.find((value) => value.toLowerCase() === preferred.toLowerCase());
    if (exact) {
      return exact;
    }

    // Accept Ubuntu variants when preferred distro is Ubuntu (e.g. Ubuntu-22.04, Ubuntu-24.04).
    if (this.isUbuntuFamilyDistro(preferred)) {
      const ubuntuCandidates = installedDistros.filter((value) => this.isUbuntuFamilyDistro(value));
      if (ubuntuCandidates.length === 0) {
        return null;
      }
      return ubuntuCandidates.find((value) => value.toLowerCase() === "ubuntu") || ubuntuCandidates[0];
    }

    return null;
  }

  private isUbuntuFamilyDistro(name: string): boolean {
    return /^ubuntu($|[-\s])/i.test(name.trim());
  }

  private isWslCommandMissingOutput(blob: string): boolean {
    return /enoent|not recognized/.test(blob);
  }

  private isWslFeatureDisabledOutput(blob: string): boolean {
    return /optional component.*not enabled|windows subsystem for linux has not been enabled|virtual machine platform.*not enabled|enable.*virtual machine platform/.test(blob);
  }

  private isNoInstalledDistrosOutput(blob: string): boolean {
    return /no installed distributions/.test(blob);
  }

  private isWslAccessDeniedOutput(blob: string): boolean {
    return /access is denied|e_accessdenied/.test(blob);
  }

  private normalizeWslOutput(text: string): string {
    return text.replace(/\u0000/g, "").replace(/\ufeff/g, "");
  }

  private async canLaunchWslDistroAsRoot(distro: string): Promise<boolean> {
    const readinessMarker = "__OPENCLAW_WSL_READY__";
    const probe = await runCommand(
      "wsl.exe",
      ["-d", distro, "-u", "root", "--", "/bin/sh", "-lc", `printf '${readinessMarker}'`],
      {
        timeoutMs: 20_000,
        env: this.buildCommandEnv()
      }
    );

    if (probe.ok) {
      return true;
    }

    // Some systems emit mount warnings (for example, a problematic Windows drive)
    // but still successfully start the distro shell.
    const output = this.normalizeWslOutput(`${probe.stdout}\n${probe.stderr}`);
    return output.includes(readinessMarker);
  }

  private getPreferredWslDistro(): string {
    return (process.env.OPENCLAW_WSL_DISTRO || DEFAULT_WSL_DISTRO).trim() || DEFAULT_WSL_DISTRO;
  }

  private async isWslUserConfigured(distro: string): Promise<boolean> {
    // Run as root to avoid triggering Ubuntu first-run interactive prompts.
    const check = await this.runWslBash(
      distro,
      "if getent passwd 1000 >/dev/null 2>&1; then exit 0; fi; if ls -1 /home 2>/dev/null | grep -v '^root$' | grep -q .; then exit 0; fi; exit 1",
      15_000,
      "root"
    );
    return check.ok;
  }

  private async installWslBrewDependencies(
    distro: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const script = [
      "set -e",
      "export DEBIAN_FRONTEND=noninteractive",
      "if ! dpkg --configure -a; then apt-get -f install -y; dpkg --configure -a; fi",
      "apt-get update",
      "apt-get install -y ca-certificates curl gnupg file git build-essential procps"
    ].join(" && ");
    return onLog
      ? this.runWslBashStreaming(distro, script, onLog, WSL_RUNTIME_INSTALL_TIMEOUT_MS, "root")
      : this.runWslBash(distro, script, WSL_RUNTIME_INSTALL_TIMEOUT_MS, "root");
  }

  private async installWslBrew(
    distro: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const brewUser = await this.resolveWslBrewUser(distro);
    if (!brewUser) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Unable to determine the non-root Ubuntu user for Homebrew installation. Finish Ubuntu user setup and retry."
      };
    }

    onLog?.(`Preparing Linuxbrew directory permissions for user ${brewUser}...`, "stdout");
    const prepResult = await this.prepareLinuxbrewPermissions(distro, brewUser, onLog);
    if (!prepResult.ok) {
      const detail = [prepResult.stderr, prepResult.stdout].filter(Boolean).join("\n").trim();
      return {
        ...prepResult,
        stderr: `${detail}\nFailed to prepare Linuxbrew directory permissions in WSL.`.trim()
      };
    }

    const script = [
      "set -e",
      "if command -v brew >/dev/null 2>&1; then brew --version; exit 0; fi",
      `if [ -x ${LINUXBREW_SYSTEM_PREFIX}/bin/brew ]; then ${LINUXBREW_SYSTEM_PREFIX}/bin/brew --version; exit 0; fi`,
      "if [ -x \"$HOME/.linuxbrew/bin/brew\" ]; then \"$HOME/.linuxbrew/bin/brew\" --version; exit 0; fi",
      "export NONINTERACTIVE=1",
      "export CI=1",
      "curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | /bin/bash",
      "if command -v brew >/dev/null 2>&1; then brew --version; exit 0; fi",
      `if [ -x ${LINUXBREW_SYSTEM_PREFIX}/bin/brew ]; then ${LINUXBREW_SYSTEM_PREFIX}/bin/brew --version; exit 0; fi`,
      "if [ -x \"$HOME/.linuxbrew/bin/brew\" ]; then \"$HOME/.linuxbrew/bin/brew\" --version; exit 0; fi",
      "exit 1"
    ].join(" && ");

    const install = onLog
      ? await this.runWslBashStreaming(distro, script, onLog, WSL_BREW_INSTALL_TIMEOUT_MS, brewUser)
      : await this.runWslBash(distro, script, WSL_BREW_INSTALL_TIMEOUT_MS, brewUser);

    if (install.ok) {
      return install;
    }

    const mergedOutput = `${install.stdout}\n${install.stderr}`;
    if (!this.isBrewPermissionFailureOutput(mergedOutput)) {
      return install;
    }

    onLog?.("Homebrew installer reported permission issues. Retrying after Linuxbrew ownership repair...", "stderr");
    const repairResult = await this.prepareLinuxbrewPermissions(distro, brewUser, onLog);
    if (!repairResult.ok) {
      const repairDetail = [repairResult.stderr, repairResult.stdout].filter(Boolean).join("\n").trim();
      return {
        ...install,
        stderr: `${install.stderr}\nAutomatic Linuxbrew ownership repair failed:\n${repairDetail}`.trim()
      };
    }

    const retry = onLog
      ? await this.runWslBashStreaming(distro, script, onLog, WSL_BREW_INSTALL_TIMEOUT_MS, brewUser)
      : await this.runWslBash(distro, script, WSL_BREW_INSTALL_TIMEOUT_MS, brewUser);

    if (retry.ok || !this.isBrewPermissionFailureOutput(`${retry.stdout}\n${retry.stderr}`)) {
      return retry;
    }

    onLog?.("System Linuxbrew prefix is still blocked. Falling back to user prefix (~/.linuxbrew)...", "stderr");
    const userPrefixPrep = await this.prepareUserPrefixBrewPermissions(distro, brewUser, onLog);
    if (!userPrefixPrep.ok) {
      const prepDetail = [userPrefixPrep.stderr, userPrefixPrep.stdout].filter(Boolean).join("\n").trim();
      onLog?.(`User-prefix ownership repair failed before fallback install:\n${prepDetail}`, "stderr");
    }
    return onLog
      ? this.installWslBrewInUserPrefixStreaming(distro, brewUser, onLog)
      : this.installWslBrewInUserPrefix(distro, brewUser);
  }

  private async resolveWslBrewUser(distro: string): Promise<string | null> {
    const currentUserResult = await this.runWslBash(distro, "id -un 2>/dev/null || true", 15_000);
    if (currentUserResult.ok) {
      const currentUser = this.normalizeWslUserName(
        currentUserResult.stdout.trim().split(/\r?\n/).filter(Boolean).pop()?.trim() || ""
      );
      if (currentUser) {
        return currentUser;
      }
    }

    const marker = "__OPENCLAW_BREW_USER__";
    const fallbackResult = await this.runWslBash(
      distro,
      [
        "set -e",
        "candidate=\"$(getent passwd 1000 | cut -d: -f1)\"",
        "if [ -z \"$candidate\" ]; then candidate=\"$(ls -1 /home 2>/dev/null | grep -v '^root$' | head -n1)\"; fi",
        `if [ -n \"$candidate\" ] && [ \"$candidate\" != \"root\" ]; then printf '${marker}%s${marker}' \"$candidate\"; else exit 1; fi`
      ].join(" && "),
      15_000,
      "root"
    );
    if (!fallbackResult.ok) {
      return null;
    }

    const fallbackBlob = this.normalizeWslOutput(`${fallbackResult.stdout}\n${fallbackResult.stderr}`);
    const match = fallbackBlob.match(/__OPENCLAW_BREW_USER__(.+?)__OPENCLAW_BREW_USER__/);
    const fallbackUser = this.normalizeWslUserName(match?.[1] || "");
    if (!fallbackUser) {
      return null;
    }
    return fallbackUser;
  }

  private async prepareLinuxbrewPermissions(
    distro: string,
    user: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const normalizedUser = this.normalizeWslUserName(user);
    if (!normalizedUser) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Unable to resolve the Ubuntu username for Linuxbrew ownership repair."
      };
    }

    const quotedUser = this.quoteForBash(normalizedUser);
    const script = [
      "set -e",
      `target_uid=\"$(id -u ${quotedUser})\"`,
      `target_gid=\"$(id -g ${quotedUser})\"`,
      "if [ -L /home/linuxbrew ]; then rm -f /home/linuxbrew; fi",
      "if [ -e /home/linuxbrew ] && [ ! -d /home/linuxbrew ]; then rm -f /home/linuxbrew; fi",
      `mkdir -p ${LINUXBREW_SYSTEM_PREFIX}`,
      "chown -R \"$target_uid:$target_gid\" /home/linuxbrew",
      "chmod -R u+rwx /home/linuxbrew"
    ].join(" && ");

    return onLog
      ? this.runWslBashStreaming(distro, script, onLog, 30_000, "root")
      : this.runWslBash(distro, script, 30_000, "root");
  }

  private async prepareUserPrefixBrewPermissions(
    distro: string,
    user: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const normalizedUser = this.normalizeWslUserName(user);
    if (!normalizedUser) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Unable to resolve the Ubuntu username for user-prefix Homebrew ownership repair."
      };
    }

    const quotedUser = this.quoteForBash(normalizedUser);
    const fallbackHome = this.quoteForBash(`/home/${normalizedUser}`);
    const script = [
      "set -e",
      `target_uid=\"$(id -u ${quotedUser})\"`,
      `target_gid=\"$(id -g ${quotedUser})\"`,
      `target_home=\"$(getent passwd ${quotedUser} | cut -d: -f6)\"`,
      `if [ -z \"$target_home\" ]; then target_home=${fallbackHome}; fi`,
      "mkdir -p \"$target_home/.linuxbrew\" \"$target_home/.cache/Homebrew\"",
      "chown -R \"$target_uid:$target_gid\" \"$target_home/.linuxbrew\" \"$target_home/.cache/Homebrew\"",
      "chmod -R u+rwx \"$target_home/.linuxbrew\" \"$target_home/.cache/Homebrew\""
    ].join(" && ");

    return onLog
      ? this.runWslBashStreaming(distro, script, onLog, 30_000, "root")
      : this.runWslBash(distro, script, 30_000, "root");
  }

  private isBrewPermissionFailureOutput(output: string): boolean {
    const blob = output.toLowerCase();
    return /permission denied|operation not permitted|not writable|writable by your user|cannot create|can't create|failed during: .*mkdir|need sudo|change the ownership|sudo chown/.test(blob);
  }

  private async getNodeRuntimeStatus(distro: string): Promise<NodeRuntimeStatus> {
    const nodeCheck = await this.runWslBash(distro, "node --version", 20_000);
    const nodejsCheck = nodeCheck.ok
      ? nodeCheck
      : await this.runWslBash(distro, "nodejs --version", 20_000);
    const npmCheck = await this.runWslBash(distro, "npm --version", 20_000);

    const nodeVersion = nodejsCheck.ok ? this.extractCommandLastLine(nodejsCheck.stdout) : null;
    const nodeMajor = nodeVersion ? this.parseNodeMajor(nodeVersion) : null;

    return {
      nodeInstalled: nodeMajor !== null && nodeMajor >= MIN_OPENCLAW_WSL_NODE_MAJOR,
      npmInstalled: npmCheck.ok,
      nodeVersion
    };
  }

  private extractCommandLastLine(output: string): string | null {
    const normalized = this.normalizeWslOutput(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized[normalized.length - 1] : null;
  }

  private parseNodeMajor(version: string): number | null {
    const match = version.trim().match(/^v?(\d+)/i);
    if (!match) {
      return null;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async isBrewAvailableForSetup(distro: string): Promise<boolean> {
    if (await this.isBrewAvailable(distro)) {
      return true;
    }

    const brewUser = await this.resolveWslBrewUser(distro);
    if (!brewUser) {
      return false;
    }

    const currentUserResult = await this.runWslBash(distro, "id -un", 15_000);
    const currentUser = currentUserResult.ok
      ? currentUserResult.stdout.trim().split(/\r?\n/).filter(Boolean).pop()?.trim() || ""
      : "";
    if (currentUser && currentUser === brewUser) {
      return false;
    }

    return this.isBrewAvailable(distro, brewUser);
  }

  private async isBrewAvailable(distro: string, user?: string): Promise<boolean> {
    const check = await this.runWslBash(
      distro,
      `if command -v brew >/dev/null 2>&1; then brew --version; elif [ -x ${LINUXBREW_SYSTEM_PREFIX}/bin/brew ]; then ${LINUXBREW_SYSTEM_PREFIX}/bin/brew --version; elif [ -x \"$HOME/.linuxbrew/bin/brew\" ]; then \"$HOME/.linuxbrew/bin/brew\" --version; else exit 1; fi`,
      20_000,
      user
    );
    return check.ok;
  }

  private async readChannelStatus(channel: ManagedChannel): Promise<ChannelStatusItem> {
    const jsonResult = await this.runOpenClaw(["channels", "status", "--channel", channel, "--json"]);

    if (jsonResult.ok) {
      try {
        const payload = this.parseJsonOutput(jsonResult.stdout, jsonResult.stderr);
        return inferChannelStatusFromPayload(channel, payload, jsonResult.stdout);
      } catch {
        return inferChannelStatusFromPayload(channel, jsonResult.stdout, jsonResult.stdout);
      }
    }

    const fallback = await this.runOpenClaw(["channels", "status", "--channel", channel]);
    const fallbackText = fallback.ok ? fallback.stdout : `${fallback.stdout}\n${fallback.stderr}`;
    return inferChannelStatusFromPayload(channel, fallbackText, fallbackText);
  }

  private getAlwaysOnTaskAction(): string {
    const distro = this.quoteForSingleQuotedPowerShell(this.getPreferredWslDistro());
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$distro = ${distro}`,
      `$cmd = '${this.buildBrewShellenvBootstrapCommand()}; export PATH=\"$HOME/.openclaw-desktop/npm/bin:$PATH\"; openclaw gateway start >/dev/null 2>&1'`,
      "wsl.exe -d $distro -- bash -lc $cmd"
    ].join("; ");
    const escapedScript = script.replace(/"/g, '\\"');
    return `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "${escapedScript}"`;
  }

  private async getScheduledTaskAlwaysOnStatus(): Promise<AlwaysOnGatewayStatus> {
    const query = await runCommand(
      "schtasks.exe",
      ["/Query", "/TN", ALWAYS_ON_TASK_NAME, "/FO", "LIST", "/V"],
      { okExitCodes: [1] }
    );

    if (query.code === 1 && isScheduledTaskMissing(query)) {
      return {
        supported: true,
        enabled: false,
        taskName: ALWAYS_ON_TASK_NAME,
        detail: "Disabled. Gateway will not auto-start at Windows sign-in."
      };
    }

    if (query.code !== 0 || !query.ok) {
      return {
        supported: true,
        enabled: false,
        taskName: ALWAYS_ON_TASK_NAME,
        detail: `Unable to read task status: ${query.stderr || query.stdout || "Unknown error"}`
      };
    }

    const statusMatch = query.stdout.match(/Status:\s*(.+)/i);
    const statusLabel = statusMatch ? statusMatch[1].trim() : "Ready";
    return {
      supported: true,
      enabled: true,
      taskName: ALWAYS_ON_TASK_NAME,
      detail: `Enabled via Windows Task Scheduler. State: ${statusLabel}.`
    };
  }

  private async enableScheduledTaskAlwaysOn(): Promise<void> {
    const createResult = await runCommand("schtasks.exe", [
      "/Create",
      "/TN",
      ALWAYS_ON_TASK_NAME,
      "/SC",
      "ONLOGON",
      "/RL",
      "LIMITED",
      "/F",
      "/TR",
      this.getAlwaysOnTaskAction()
    ]);

    if (!createResult.ok) {
      throw new Error(createResult.stderr || createResult.stdout || "Failed to create always-on gateway task.");
    }
  }

  private async disableScheduledTaskAlwaysOn(): Promise<void> {
    const deleteResult = await runCommand(
      "schtasks.exe",
      ["/Delete", "/TN", ALWAYS_ON_TASK_NAME, "/F"],
      { okExitCodes: [1] }
    );

    if (deleteResult.code === 1 && isScheduledTaskMissing(deleteResult)) {
      return;
    }

    if (deleteResult.code !== 0 || !deleteResult.ok) {
      throw new Error(deleteResult.stderr || deleteResult.stdout || "Failed to delete always-on gateway task.");
    }
  }

  private async getSystemdAlwaysOnStatus(): Promise<{ supported: boolean; enabled: boolean; detail: string }> {
    if (process.platform !== "win32") {
      return { supported: false, enabled: false, detail: "Not on Windows." };
    }

    const wslStatus = await this.getWslStatus();
    if (!wslStatus.wslInstalled || !wslStatus.distroInstalled || !wslStatus.distroReachable) {
      return { supported: false, enabled: false, detail: "WSL distro is not ready." };
    }

    const distro = wslStatus.distro;
    const cliUser = await this.resolveWslBrewUser(distro);
    if (!cliUser) {
      return { supported: false, enabled: false, detail: "No non-root WSL user configured yet." };
    }

    const systemdCheck = await this.runWslBash(
      distro,
      "if [ \"$(ps -p 1 -o comm= | tr -d '[:space:]')\" = \"systemd\" ] && command -v systemctl >/dev/null 2>&1; then echo ok; else echo unavailable; fi",
      20_000,
      cliUser
    );
    if (!systemdCheck.ok || !/\bok\b/i.test(systemdCheck.stdout)) {
      return { supported: false, enabled: false, detail: "WSL systemd is not available." };
    }

    const statusResult = await this.runWslBash(
      distro,
      [
        `enabled_state="$(systemctl --user is-enabled ${ALWAYS_ON_SYSTEMD_USER_SERVICE} 2>&1 || true)"`,
        `active_state="$(systemctl --user is-active ${ALWAYS_ON_SYSTEMD_USER_SERVICE} 2>&1 || true)"`,
        "echo \"enabled:$enabled_state\"",
        "echo \"active:$active_state\""
      ].join("; "),
      20_000,
      cliUser
    );
    if (!statusResult.ok) {
      return { supported: true, enabled: false, detail: "Could not read systemd user service status." };
    }

    const raw = `${statusResult.stdout}\n${statusResult.stderr}`.toLowerCase();
    const enabled = /enabled:enabled/.test(raw) || /active:active/.test(raw);
    const detail = enabled
      ? "WSL systemd user service is enabled."
      : "WSL systemd user service is disabled.";

    return { supported: true, enabled, detail };
  }

  private async enableSystemdAlwaysOn(): Promise<{ ok: boolean; detail: string }> {
    const wslStatus = await this.getWslStatus();
    if (!wslStatus.wslInstalled || !wslStatus.distroInstalled || !wslStatus.distroReachable) {
      return { ok: false, detail: "WSL distro is not ready." };
    }

    const distro = wslStatus.distro;
    const cliUser = await this.resolveWslBrewUser(distro);
    if (!cliUser) {
      return { ok: false, detail: "No non-root WSL user configured yet." };
    }

    const check = await this.getSystemdAlwaysOnStatus();
    if (!check.supported) {
      return { ok: false, detail: check.detail };
    }

    // Best-effort: keep the user service active across WSL boots if linger is available.
    await this.runWslBash(
      distro,
      `if command -v loginctl >/dev/null 2>&1; then loginctl enable-linger ${this.quoteForBash(cliUser)} >/dev/null 2>&1 || true; fi`,
      20_000,
      "root"
    ).catch(() => {});

    const unitContent = [
      "[Unit]",
      "Description=OpenClaw Gateway",
      "After=network-online.target",
      "",
      "[Service]",
      "Type=oneshot",
      "RemainAfterExit=yes",
      `ExecStart=/bin/bash -lc '${this.buildBrewShellenvBootstrapCommand()}; export PATH=\"$HOME/.openclaw-desktop/npm/bin:$PATH\"; openclaw gateway start'`,
      `ExecStop=/bin/bash -lc '${this.buildBrewShellenvBootstrapCommand()}; export PATH=\"$HOME/.openclaw-desktop/npm/bin:$PATH\"; openclaw gateway stop'`,
      "",
      "[Install]",
      "WantedBy=default.target"
    ].join("\n");
    const encodedUnit = Buffer.from(unitContent, "utf8").toString("base64");

    const configureResult = await this.runWslBash(
      distro,
      [
        "set -e",
        "mkdir -p \"$HOME/.config/systemd/user\"",
        `echo ${encodedUnit} | base64 -d > "$HOME/.config/systemd/user/${ALWAYS_ON_SYSTEMD_USER_SERVICE}"`,
        "systemctl --user daemon-reload",
        `systemctl --user enable --now ${ALWAYS_ON_SYSTEMD_USER_SERVICE}`
      ].join("; "),
      45_000,
      cliUser
    );
    if (!configureResult.ok) {
      return { ok: false, detail: configureResult.stderr || configureResult.stdout || "Unknown systemd failure." };
    }

    await this.disableScheduledTaskAlwaysOn().catch(() => {});
    return { ok: true, detail: "Enabled via WSL systemd user service." };
  }

  private async disableSystemdAlwaysOn(): Promise<void> {
    const wslStatus = await this.getWslStatus();
    if (!wslStatus.wslInstalled || !wslStatus.distroInstalled || !wslStatus.distroReachable) {
      return;
    }

    const distro = wslStatus.distro;
    const cliUser = await this.resolveWslBrewUser(distro);
    if (!cliUser) {
      return;
    }

    const status = await this.getSystemdAlwaysOnStatus();
    if (!status.supported) {
      return;
    }

    await this.runWslBash(
      distro,
      [
        `systemctl --user disable --now ${ALWAYS_ON_SYSTEMD_USER_SERVICE} >/dev/null 2>&1 || true`,
        "systemctl --user daemon-reload >/dev/null 2>&1 || true"
      ].join("; "),
      30_000,
      cliUser
    ).catch(() => {});
  }

  private runWizardCall<T>(method: string, params: unknown): Promise<T> {
    return this.gatewayCall<T>(method, params);
  }

  private async runOpenClaw(args: string[]): Promise<CommandResult> {
    if (process.platform === "win32") {
      const wslStatus = await this.getWslStatus();
      if (wslStatus.wslInstalled && wslStatus.distroInstalled && wslStatus.distroReachable) {
        return this.runOpenClawInWsl(wslStatus.distro, args);
      }
    }

    const command = await this.resolveOpenClawCommand();
    return runCommand(command, args, { env: this.buildCommandEnv() });
  }

  private async runOpenClawStreaming(
    args: string[],
    onLog: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    if (process.platform === "win32") {
      const wslStatus = await this.getWslStatus();
      if (wslStatus.wslInstalled && wslStatus.distroInstalled && wslStatus.distroReachable) {
        return this.runOpenClawInWslStreaming(wslStatus.distro, args, onLog);
      }
    }

    const command = await this.resolveOpenClawCommand();
    return runCommandStreaming(command, args, {
      env: this.buildCommandEnv(),
      onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
      onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
    });
  }

  private async isOpenClawAvailable(distro?: string, clearCache = false): Promise<boolean> {
    if (clearCache) {
      this.resolvedOpenClawCommand = "";
    }

    if (process.platform === "win32") {
      const activeDistro = distro || this.getPreferredWslDistro();
      const result = await this.runOpenClawInWsl(activeDistro, ["--version"]);
      if (result.ok) {
        return true;
      }

      // Fallback: verify the app-managed install location directly.
      if (await this.isManagedOpenClawAvailableInWsl(activeDistro)) {
        return true;
      }
    }

    try {
      await this.resolveOpenClawCommand();
      return true;
    } catch {
      return false;
    }
  }

  private async runOpenClawInWsl(distro: string, args: string[]): Promise<CommandResult> {
    const command = this.buildWslOpenClawCommand(args);
    const cliUser = await this.resolveWslBrewUser(distro);
    return this.runWslBash(distro, command, OPENCLAW_INSTALL_TIMEOUT_MS, cliUser || undefined);
  }

  private async runOpenClawInWslStreaming(
    distro: string,
    args: string[],
    onLog: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const command = this.buildWslOpenClawCommand(args);
    const cliUser = await this.resolveWslBrewUser(distro);
    return this.runWslBashStreaming(distro, command, onLog, OPENCLAW_INSTALL_TIMEOUT_MS, cliUser || undefined);
  }

  private buildWslOpenClawCommand(args: string[]): string {
    const quotedArgs = args.map((arg) => this.quoteForBash(arg)).join(" ");
    const managedInvoke = quotedArgs
      ? `"$HOME/.openclaw-desktop/npm/bin/openclaw" ${quotedArgs}`
      : "\"$HOME/.openclaw-desktop/npm/bin/openclaw\"";
    const pathInvoke = quotedArgs ? `openclaw ${quotedArgs}` : "openclaw";
    return [
      this.buildBrewShellenvBootstrapCommand(),
      "export PATH=\"$HOME/.openclaw-desktop/npm/bin:$PATH\"",
      `if [ -x "$HOME/.openclaw-desktop/npm/bin/openclaw" ]; then ${managedInvoke}; elif command -v openclaw >/dev/null 2>&1; then ${pathInvoke}; else echo "openclaw CLI not found in WSL." >&2; exit 127; fi`
    ].join("; ");
  }

  private buildBrewShellenvBootstrapCommand(): string {
    return [
      "if command -v brew >/dev/null 2>&1; then :",
      `elif [ -x ${LINUXBREW_SYSTEM_PREFIX}/bin/brew ]; then export HOMEBREW_PREFIX=${LINUXBREW_SYSTEM_PREFIX}; export HOMEBREW_REPOSITORY=${LINUXBREW_SYSTEM_PREFIX}/Homebrew; export HOMEBREW_CELLAR=${LINUXBREW_SYSTEM_PREFIX}/Cellar; export PATH=${LINUXBREW_SYSTEM_PREFIX}/bin:${LINUXBREW_SYSTEM_PREFIX}/sbin:\"$PATH\"; export MANPATH=${LINUXBREW_SYSTEM_PREFIX}/share/man:\"\${MANPATH:-}\"; export INFOPATH=${LINUXBREW_SYSTEM_PREFIX}/share/info:\"\${INFOPATH:-}\"`,
      "elif [ -x \"$HOME/.linuxbrew/bin/brew\" ]; then export HOMEBREW_PREFIX=\"$HOME/.linuxbrew\"; export HOMEBREW_REPOSITORY=\"$HOMEBREW_PREFIX/Homebrew\"; export HOMEBREW_CELLAR=\"$HOMEBREW_PREFIX/Cellar\"; export PATH=\"$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin:$PATH\"; export MANPATH=\"$HOMEBREW_PREFIX/share/man:${MANPATH:-}\"; export INFOPATH=\"$HOMEBREW_PREFIX/share/info:${INFOPATH:-}\"",
      "fi"
    ].join("; ");
  }

  private installWslBrewInUserPrefix(
    distro: string,
    user: string
  ): Promise<CommandResult> {
    return this.runWslBash(distro, this.buildUserPrefixBrewInstallScript(), WSL_BREW_INSTALL_TIMEOUT_MS, user);
  }

  private installWslBrewInUserPrefixStreaming(
    distro: string,
    user: string,
    onLog: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    return this.runWslBashStreaming(distro, this.buildUserPrefixBrewInstallScript(), onLog, WSL_BREW_INSTALL_TIMEOUT_MS, user);
  }

  private buildUserPrefixBrewInstallScript(): string {
    return [
      "set -e",
      "if [ -z \"${HOME:-}\" ]; then HOME=\"$(getent passwd \"$(id -u)\" | cut -d: -f6)\"; fi",
      "if [ -z \"${HOME:-}\" ]; then HOME=\"/home/$(id -un)\"; fi",
      "if command -v brew >/dev/null 2>&1; then brew --version; exit 0; fi",
      "if [ -x \"$HOME/.linuxbrew/bin/brew\" ]; then \"$HOME/.linuxbrew/bin/brew\" --version; exit 0; fi",
      "export NONINTERACTIVE=1",
      "export CI=1",
      "export HOMEBREW_PREFIX=\"$HOME/.linuxbrew\"",
      "export HOMEBREW_REPOSITORY=\"$HOMEBREW_PREFIX/Homebrew\"",
      "export HOMEBREW_CELLAR=\"$HOMEBREW_PREFIX/Cellar\"",
      "export HOMEBREW_CACHE=\"$HOME/.cache/Homebrew\"",
      "mkdir -p \"$HOMEBREW_PREFIX\" \"$HOMEBREW_CACHE\"",
      "if [ ! -d \"$HOMEBREW_REPOSITORY/.git\" ]; then git clone --depth=1 https://github.com/Homebrew/brew \"$HOMEBREW_REPOSITORY\"; fi",
      "mkdir -p \"$HOMEBREW_PREFIX/bin\" \"$HOMEBREW_PREFIX/sbin\"",
      "ln -sf ../Homebrew/bin/brew \"$HOMEBREW_PREFIX/bin/brew\"",
      "export PATH=\"$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin:$PATH\"",
      "export MANPATH=\"$HOMEBREW_PREFIX/share/man:${MANPATH:-}\"",
      "export INFOPATH=\"$HOMEBREW_PREFIX/share/info:${INFOPATH:-}\"",
      "\"$HOMEBREW_PREFIX/bin/brew\" --version"
    ].join(" && ");
  }

  private normalizeWslUserName(value: string): string {
    const normalized = this.normalizeWslOutput(value).trim().replace(/^['"]+|['"]+$/g, "");
    if (!normalized) {
      return "";
    }

    if (!/^[a-z_][a-z0-9_.-]*[$]?$/i.test(normalized)) {
      return "";
    }

    if (normalized.toLowerCase() === "root") {
      return "";
    }

    return normalized;
  }

  private async isManagedOpenClawAvailableInWsl(distro: string): Promise<boolean> {
    const checkScript =
      "if [ -x \"$HOME/.openclaw-desktop/npm/bin/openclaw\" ]; then \"$HOME/.openclaw-desktop/npm/bin/openclaw\" --version >/dev/null 2>&1; else exit 1; fi";

    const defaultUserCheck = await this.runWslBash(distro, checkScript, 20_000);
    if (defaultUserCheck.ok) {
      return true;
    }

    const cliUser = await this.resolveWslBrewUser(distro);
    if (!cliUser) {
      return false;
    }

    const explicitUserCheck = await this.runWslBash(distro, checkScript, 20_000, cliUser);
    return explicitUserCheck.ok;
  }

  private async resolveOpenClawCommand(): Promise<string> {
    if (this.resolvedOpenClawCommand) {
      return this.resolvedOpenClawCommand;
    }

    const candidates = this.getOpenClawCommandCandidates();

    for (const candidate of candidates) {
      if (path.isAbsolute(candidate) && !(await this.fileExists(candidate))) {
        continue;
      }

      const result = await runCommand(candidate, ["--version"], { env: this.buildCommandEnv() });
      if (result.ok) {
        this.resolvedOpenClawCommand = candidate;
        return candidate;
      }
    }

    throw new Error("OpenClaw CLI not found. Install OpenClaw first.");
  }

  private getOpenClawCommandCandidates(): string[] {
    const managed = this.getManagedOpenClawPath();
    if (process.platform === "win32") {
      return [managed, "openclaw.cmd", "openclaw"];
    }

    return [managed, "openclaw"];
  }

  private async runWslBash(
    distro: string,
    command: string,
    timeoutMs: number,
    user?: string
  ): Promise<CommandResult> {
    const scriptPath = await this.writeWslTempScript(distro, command);
    try {
      const args = ["-d", distro];
      if (user) {
        args.push("-u", user);
      }
      args.push("--", "bash", "-l", scriptPath);
      return await runCommand("wsl.exe", args, {
        timeoutMs,
        env: this.buildCommandEnv()
      });
    } finally {
      this.removeWslTempScript(distro, scriptPath);
    }
  }

  private async runWslBashStreaming(
    distro: string,
    command: string,
    onLog: (line: string, stream: "stdout" | "stderr") => void,
    timeoutMs: number,
    user?: string
  ): Promise<CommandResult> {
    const scriptPath = await this.writeWslTempScript(distro, command);
    try {
      const args = ["-d", distro];
      if (user) {
        args.push("-u", user);
      }
      args.push("--", "bash", "-l", scriptPath);
      return await runCommandStreaming("wsl.exe", args, {
        timeoutMs,
        env: this.buildCommandEnv(),
        onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
        onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
      });
    } finally {
      this.removeWslTempScript(distro, scriptPath);
    }
  }

  private async writeWslTempScript(distro: string, command: string): Promise<string> {
    const scriptName = `_oc_setup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sh`;
    const wslPath = `/tmp/${scriptName}`;
    const normalizedCommand = [
      // Some Windows environments leak HOME into WSL as "C:Users<name>".
      // Normalize HOME to the Linux passwd home so auth/config paths resolve
      // consistently (e.g. /home/<user>/.openclaw/...).
      "if [ -z \"${HOME:-}\" ] || echo \"${HOME}\" | grep -Eq '^[A-Za-z]:'; then HOME=\"$(getent passwd \"$(id -u)\" | cut -d: -f6)\"; fi",
      "if [ -z \"${HOME:-}\" ]; then HOME=\"/home/$(id -un)\"; fi",
      "export HOME",
      command
    ].join("; ");
    // Write the script into WSL /tmp via a simple echo. The command content is
    // base64-encoded to avoid any quoting/escaping issues with wsl.exe argument
    // forwarding.
    const encoded = Buffer.from(normalizedCommand, "utf8").toString("base64");
    await runCommand("wsl.exe", ["-d", distro, "--", "bash", "-c",
      `echo ${encoded} | base64 -d > ${wslPath} && chmod +x ${wslPath}`], {
      timeoutMs: 15_000,
      env: this.buildCommandEnv()
    });
    return wslPath;
  }

  private removeWslTempScript(distro: string, wslPath: string): void {
    runCommand("wsl.exe", ["-d", distro, "--", "rm", "-f", wslPath], {
      timeoutMs: 10_000,
      env: this.buildCommandEnv()
    }).catch(() => {});
  }

  private buildCommandEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const prefix = this.getManagedNpmPrefix();

    if (process.platform === "win32") {
      // Avoid leaking Windows HOME into WSL commands where it becomes
      // "C:Users<name>" and breaks Linux path resolution.
      delete env.HOME;
      // Windows env vars are case-insensitive, but Node's process.env object
      // can contain both "Path" and "PATH". Consolidate to a single key to
      // avoid confusing tools that do case-sensitive lookups.
      const currentPath = env.Path || env.PATH || "";
      delete env.Path;
      delete env.PATH;
      env.Path = [prefix, currentPath].filter(Boolean).join(path.delimiter);
    } else {
      const currentPath = env.PATH || "";
      env.PATH = [prefix, currentPath].filter(Boolean).join(path.delimiter);
    }

    return env;
  }

  private getManagedNpmPrefix(): string {
    if (process.platform !== "win32") {
      return path.join(os.homedir(), ".openclaw-desktop", "npm");
    }

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "OpenClawDesktop", "npm");
  }

  private getManagedOpenClawPath(): string {
    if (process.platform === "win32") {
      return path.join(this.getManagedNpmPrefix(), "openclaw.cmd");
    }
    return path.join(this.getManagedNpmPrefix(), "openclaw");
  }

  private resolveNodeCommand(): string {
    return process.platform === "win32" ? "node.exe" : "node";
  }

  private resolveNpmCommand(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
  }

  private async ensureMinimumFreeSpace(
    targetPath: string,
    minimumBytes: number,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult | null> {
    const freeBytes = await this.getAvailableFreeBytes(targetPath);
    if (freeBytes === null) {
      onLog?.("Disk space pre-check unavailable. Continuing installation.", "stderr");
      return null;
    }

    const driveRoot = path.parse(targetPath).root || targetPath;
    if (freeBytes < minimumBytes) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: `Insufficient disk space on ${driveRoot}. Required ${this.formatBytes(minimumBytes)}, available ${this.formatBytes(freeBytes)}.`
      };
    }

    onLog?.(`Disk space check passed on ${driveRoot}: ${this.formatBytes(freeBytes)} free.`, "stdout");
    return null;
  }

  private async getAvailableFreeBytes(targetPath: string): Promise<number | null> {
    if (process.platform !== "win32") {
      return null;
    }

    const root = path.parse(targetPath).root || "C:\\";
    const normalizedRoot = root.endsWith("\\") ? root : `${root}\\`;
    const quotedRoot = this.quoteForSingleQuotedPowerShell(normalizedRoot);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$root = [System.IO.Path]::GetPathRoot(${quotedRoot})`,
      "$drive = New-Object System.IO.DriveInfo($root)",
      "Write-Output $drive.AvailableFreeSpace"
    ].join("; ");
    const result = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeoutMs: DISK_CHECK_TIMEOUT_MS, env: this.buildCommandEnv() }
    );

    if (!result.ok) {
      return null;
    }

    const parsed = Number(result.stdout.trim().split(/\r?\n/).at(-1));
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  private formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1024; index += 1) {
      value /= 1024;
      unit = units[index];
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
  }

  private composeNodeInstallFailure(wingetResult: CommandResult, msiResult: CommandResult): CommandResult {
    const wingetDetail = [wingetResult.stderr, wingetResult.stdout].filter(Boolean).join("\n").trim() || "No output.";
    const msiDetail = [msiResult.stderr, msiResult.stdout].filter(Boolean).join("\n").trim() || "No output.";
    const hint = this.detectInstallFailureHint(`${wingetDetail}\n${msiDetail}`);
    return {
      ok: false,
      code: msiResult.code ?? wingetResult.code,
      stdout: [wingetResult.stdout, msiResult.stdout].filter(Boolean).join("\n"),
      stderr: [
        "Node.js installation failed with both methods.",
        `winget attempt:\n${wingetDetail}`,
        `MSI fallback:\n${msiDetail}`,
        hint
      ].filter(Boolean).join("\n\n")
    };
  }

  private detectInstallFailureHint(output: string): string {
    const blob = output.toLowerCase();
    if (/cancel|1602|1223/.test(blob)) {
      return "Install was cancelled. Accept the UAC prompt and retry.";
    }
    if (/winget\.exe not found|not recognized/.test(blob)) {
      return "winget is unavailable. Keep MSI fallback enabled or install App Installer from Microsoft Store.";
    }
    if (/timed out|timeout/.test(blob)) {
      return "Installer timed out. Check network speed and retry.";
    }
    if (/network|unable to connect|name resolution|download|tls|certificate/.test(blob)) {
      return "Network issue detected. Verify internet access and retry.";
    }
    if (/access is denied|permission|policy|blocked|administrator/.test(blob)) {
      return "Permissions/policy blocked installation. Run as Administrator or contact IT admin.";
    }
    return "Retry guided setup. If it keeps failing, install Node.js LTS manually and rerun setup.";
  }

  private async isNodeInstalledInWellKnownPaths(): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }

    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const candidates = [
      path.join(programFiles, "nodejs"),
      path.join(programFilesX86, "nodejs"),
      path.join(localAppData, "Programs", "nodejs")
    ];

    for (const basePath of candidates) {
      const nodeExists = await this.fileExists(path.join(basePath, "node.exe"));
      const npmExists = await this.fileExists(path.join(basePath, "npm.cmd"));
      if (nodeExists && npmExists) {
        return true;
      }
    }

    return false;
  }

  private quoteForSingleQuotedPowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private quoteForBash(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private emitChunkLines(
    chunk: string,
    stream: "stdout" | "stderr",
    onLog: (line: string, stream: "stdout" | "stderr") => void
  ): void {
    const normalized = chunk.replace(/\r/g, "\n");
    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      onLog(line, stream);
    }
  }

  private parseJsonOutput(stdout: string, stderr: string): unknown {
    const trimmedStdout = stdout.trim();
    const candidates = [trimmedStdout, ...stdout.split(/\r?\n/).map((line) => line.trim()).reverse()];

    const braceStart = trimmedStdout.indexOf("{");
    const braceEnd = trimmedStdout.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      candidates.push(trimmedStdout.slice(braceStart, braceEnd + 1));
    }

    const bracketStart = trimmedStdout.indexOf("[");
    const bracketEnd = trimmedStdout.lastIndexOf("]");
    if (bracketStart >= 0 && bracketEnd > bracketStart) {
      candidates.push(trimmedStdout.slice(bracketStart, bracketEnd + 1));
    }

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }

    const merged = `${stdout}\n${stderr}`.trim();
    throw new Error(`Unable to parse JSON output: ${merged}`);
  }
}
