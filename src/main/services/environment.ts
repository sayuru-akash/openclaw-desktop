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
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand, runCommandStreaming } from "./command-runner";
import {
  inferChannelStatusFromPayload,
  inferModelStatusFromPayload,
  isScheduledTaskMissing
} from "./parsers";

const ALWAYS_ON_TASK_NAME = "OpenClawDesktopAlwaysOnGateway";
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

export class EnvironmentService {
  private resolvedOpenClawCommand = "";

  public async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    const wslDistro = this.getPreferredWslDistro();
    const status: EnvironmentStatus = {
      checkedAt: new Date().toISOString(),
      platform: process.platform,
      isWindows: process.platform === "win32",
      wslInstalled: false,
      wslDistro,
      wslDistroInstalled: false,
      wslReady: false,
      wslUserConfigured: false,
      nodeInstalled: false,
      npmInstalled: false,
      brewInstalled: false,
      openClawInstalled: false,
      gatewayRunning: false,
      notes: []
    };

    if (!status.isWindows) {
      status.notes.push("Setup checks are unavailable in this environment.");
      return status;
    }

    const wslStatus = await this.getWslStatus();
    status.wslInstalled = wslStatus.wslInstalled;
    status.wslDistro = wslStatus.distro;
    status.wslDistroInstalled = wslStatus.distroInstalled;
    status.wslReady = wslStatus.wslInstalled && wslStatus.distroInstalled;

    if (!status.wslInstalled) {
      status.notes.push("WSL is not ready. Install WSL and Ubuntu first.");
      return status;
    }

    if (!status.wslDistroInstalled) {
      status.notes.push(`WSL distro ${status.wslDistro} is not installed yet.`);
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
        status.notes.push("node command is missing in WSL.");
      }
      if (!status.npmInstalled) {
        status.notes.push("npm command is missing in WSL.");
      }
      return status;
    }

    status.brewInstalled = await this.isBrewAvailable(status.wslDistro);
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
    status.gatewayRunning = gatewayStatus.ok && /running|active|ok/i.test(`${gatewayStatus.stdout} ${gatewayStatus.stderr}`);

    if (!status.gatewayRunning) {
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

    const distro = this.getPreferredWslDistro();
    const quotedDistro = this.quoteForSingleQuotedPowerShell(distro);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$process = Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', ${quotedDistro}) -PassThru`,
      "Write-Output ('Launched Ubuntu setup process id: ' + $process.Id)",
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

  public gatewayStatus(): Promise<CommandResult> {
    return this.runOpenClaw(["gateway", "status"]);
  }

  public gatewayStart(): Promise<CommandResult> {
    return this.runOpenClaw(["gateway", "start"]);
  }

  public gatewayStartStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    return this.runOpenClawStreaming(["gateway", "start"], onLog);
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
    const result = await this.runOpenClaw(["models", "list", "--json"]);
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
      detail: inferred.detail
    };
  }

  public async applyModelSelection(provider: string, model: string): Promise<ModelStatusResult> {
    const normalizedProvider = provider.trim();
    const normalizedModel = model.trim();

    if (!normalizedProvider || !normalizedModel) {
      throw new Error("Provider and model are required.");
    }

    const result = await this.runOpenClaw([
      "models",
      "set",
      "--provider",
      normalizedProvider,
      "--model",
      normalizedModel,
      "--json"
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
      detail: `Enabled. Task Scheduler state: ${statusLabel}.`
    };
  }

  public async setAlwaysOnGatewayEnabled(enabled: boolean): Promise<AlwaysOnGatewayStatus> {
    if (process.platform !== "win32") {
      throw new Error("Always-on gateway is supported only on Windows.");
    }

    if (enabled) {
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

      void this.gatewayStart();
      return this.getAlwaysOnGatewayStatus();
    }

    const deleteResult = await runCommand(
      "schtasks.exe",
      ["/Delete", "/TN", ALWAYS_ON_TASK_NAME, "/F"],
      { okExitCodes: [1] }
    );

    if (deleteResult.code === 1 && isScheduledTaskMissing(deleteResult)) {
      return this.getAlwaysOnGatewayStatus();
    }

    if (deleteResult.code !== 0 || !deleteResult.ok) {
      throw new Error(deleteResult.stderr || deleteResult.stdout || "Failed to delete always-on gateway task.");
    }

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
      if (!postWslStatus.wslInstalled || !postWslStatus.distroInstalled) {
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
      return {
        ok: false,
        code: lastResult?.code ?? null,
        stdout: lastResult?.stdout ?? "",
        stderr: "WSL runtime install finished but node/npm are still unavailable. Open Ubuntu once, then retry setup."
      };
    }

    const brewInstalled = await this.isBrewAvailable(distro);
    if (!brewInstalled) {
      onLog?.(`Installing Homebrew in WSL distro ${distro}...`, "stdout");
      const brewInstall = await this.installWslBrew(distro, onLog);
      lastResult = brewInstall;
      if (!brewInstall.ok) {
        const detail = [brewInstall.stderr, brewInstall.stdout].filter(Boolean).join("\n").trim();
        return {
          ...brewInstall,
          stderr: `${detail}\n${this.detectBrewInstallFailureHint(detail)}`.trim()
        };
      }
    }

    const finalBrewInstalled = await this.isBrewAvailable(distro);
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
    if (!wslStatus.wslInstalled || !wslStatus.distroInstalled) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "WSL is not ready. Install WSL first."
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
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Runtime dependencies are missing in WSL. Install WSL runtime first."
      };
    }

    const brewInstalled = await this.isBrewAvailable(distro);
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

    const installScript = [
      "set -e",
      "mkdir -p \"$HOME/.openclaw-desktop/npm\"",
      "npm install -g openclaw --prefix \"$HOME/.openclaw-desktop/npm\" --no-fund --no-audit"
    ].join(" && ");

    const result = onLog
      ? await this.runWslBashStreaming(distro, installScript, onLog, OPENCLAW_INSTALL_TIMEOUT_MS)
      : await this.runWslBash(distro, installScript, OPENCLAW_INSTALL_TIMEOUT_MS);

    if (!result.ok) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      return {
        ...result,
        stderr: `${detail}\nOpenClaw npm install in WSL failed. Check internet, npm registry access, and WSL distro health.`.trim()
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
      "apt-get update",
      "apt-get install -y nodejs npm ca-certificates curl file git build-essential procps"
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
    if (/dpkg was interrupted|apt --fix-broken/.test(blob)) {
      return "WSL package manager is in a broken state. Run apt repair in Ubuntu and retry.";
    }
    return "Runtime install in WSL failed. Open Ubuntu once to finish distro initialization, then retry.";
  }

  private detectBrewInstallFailureHint(output: string): string {
    const blob = output.toLowerCase();
    if (/network|timed out|timeout|could not resolve|failed to connect/.test(blob)) {
      return "Network issue detected while installing Homebrew in WSL.";
    }
    if (/sudo|permission denied|operation not permitted/.test(blob)) {
      return "Homebrew installer was blocked by permissions. Ensure the WSL user is configured normally and retry.";
    }
    return "Homebrew install in WSL failed. Open Ubuntu, run the Homebrew installer once manually, then retry setup.";
  }

  private async getWslStatus(): Promise<{ wslInstalled: boolean; distroInstalled: boolean; distro: string }> {
    const distro = this.getPreferredWslDistro();

    if (process.platform !== "win32") {
      return { wslInstalled: false, distroInstalled: false, distro };
    }

    const list = await runCommand("wsl.exe", ["-l", "-q"], {
      okExitCodes: [1],
      timeoutMs: 20_000,
      env: this.buildCommandEnv()
    });

    const merged = `${list.stdout}\n${list.stderr}`.toLowerCase();
    if (!list.ok && list.code === null && /enoent|not recognized/.test(merged)) {
      return { wslInstalled: false, distroInstalled: false, distro };
    }

    const distributions = list.stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/\u0000/g, "").trim())
      .filter(Boolean);

    if (distributions.length === 0 && /no installed distributions/.test(merged)) {
      return { wslInstalled: true, distroInstalled: false, distro };
    }

    const distroInstalled = distributions.some((value) => value.toLowerCase() === distro.toLowerCase());
    return { wslInstalled: true, distroInstalled, distro };
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

  private async installWslBrew(
    distro: string,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const script = [
      "set -e",
      "if command -v brew >/dev/null 2>&1; then brew --version; exit 0; fi",
      "if [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then eval \"$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)\"; brew --version; exit 0; fi",
      "export NONINTERACTIVE=1",
      "export CI=1",
      "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
      "if [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then eval \"$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)\"; fi",
      "brew --version"
    ].join(" && ");

    return onLog
      ? this.runWslBashStreaming(distro, script, onLog, WSL_BREW_INSTALL_TIMEOUT_MS)
      : this.runWslBash(distro, script, WSL_BREW_INSTALL_TIMEOUT_MS);
  }

  private async getNodeRuntimeStatus(distro: string): Promise<{ nodeInstalled: boolean; npmInstalled: boolean }> {
    const nodeCheck = await this.runWslBash(distro, "node --version", 20_000);
    const npmCheck = await this.runWslBash(distro, "npm --version", 20_000);
    return {
      nodeInstalled: nodeCheck.ok,
      npmInstalled: npmCheck.ok
    };
  }

  private async isBrewAvailable(distro: string): Promise<boolean> {
    const check = await this.runWslBash(
      distro,
      "if command -v brew >/dev/null 2>&1; then brew --version; elif [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then eval \"$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)\"; brew --version; else exit 1; fi",
      20_000
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
      "$cmd = 'if [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then eval \"$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)\"; fi; export PATH=\"$HOME/.openclaw-desktop/npm/bin:$PATH\"; openclaw gateway start >/dev/null 2>&1'",
      "wsl.exe -d $distro -- bash -lc $cmd"
    ].join("; ");
    const escapedScript = script.replace(/"/g, '\\"');
    return `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "${escapedScript}"`;
  }

  private async runWizardCall<T>(method: string, params: unknown): Promise<T> {
    const payload = JSON.stringify(params);
    const result = await this.runOpenClaw(["gateway", "call", method, "--params", payload, "--json"]);

    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || `${method} failed`);
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

  private async runOpenClaw(args: string[]): Promise<CommandResult> {
    if (process.platform === "win32") {
      const wslStatus = await this.getWslStatus();
      if (wslStatus.wslInstalled && wslStatus.distroInstalled) {
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
      if (wslStatus.wslInstalled && wslStatus.distroInstalled) {
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
    }

    try {
      await this.resolveOpenClawCommand();
      return true;
    } catch {
      return false;
    }
  }

  private runOpenClawInWsl(distro: string, args: string[]): Promise<CommandResult> {
    const command = this.buildWslOpenClawCommand(args);
    return this.runWslBash(distro, command, OPENCLAW_INSTALL_TIMEOUT_MS);
  }

  private runOpenClawInWslStreaming(
    distro: string,
    args: string[],
    onLog: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const command = this.buildWslOpenClawCommand(args);
    return this.runWslBashStreaming(distro, command, onLog, OPENCLAW_INSTALL_TIMEOUT_MS);
  }

  private buildWslOpenClawCommand(args: string[]): string {
    const quotedArgs = args.map((arg) => this.quoteForBash(arg)).join(" ");
    return [
      "if [ -x /home/linuxbrew/.linuxbrew/bin/brew ]; then eval \"$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)\"; fi",
      "export PATH=\"$HOME/.openclaw-desktop/npm/bin:$PATH\"",
      "OPENCLAW_CMD=\"$HOME/.openclaw-desktop/npm/bin/openclaw\"",
      "if [ ! -x \"$OPENCLAW_CMD\" ]; then OPENCLAW_CMD=\"openclaw\"; fi",
      quotedArgs ? `$OPENCLAW_CMD ${quotedArgs}` : "$OPENCLAW_CMD"
    ].join("; ");
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

  private runWslBash(
    distro: string,
    command: string,
    timeoutMs: number,
    user?: string
  ): Promise<CommandResult> {
    const args = ["-d", distro];
    if (user) {
      args.push("-u", user);
    }
    args.push("--", "bash", "-lc", command);
    return runCommand("wsl.exe", args, {
      timeoutMs,
      env: this.buildCommandEnv()
    });
  }

  private runWslBashStreaming(
    distro: string,
    command: string,
    onLog: (line: string, stream: "stdout" | "stderr") => void,
    timeoutMs: number,
    user?: string
  ): Promise<CommandResult> {
    const args = ["-d", distro];
    if (user) {
      args.push("-u", user);
    }
    args.push("--", "bash", "-lc", command);
    return runCommandStreaming("wsl.exe", args, {
      timeoutMs,
      env: this.buildCommandEnv(),
      onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
      onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
    });
  }

  private buildCommandEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const prefix = this.getManagedNpmPrefix();

    if (process.platform === "win32") {
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
