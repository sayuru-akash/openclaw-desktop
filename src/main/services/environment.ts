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
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand, runCommandStreaming } from "./command-runner";
import {
  inferChannelStatusFromPayload,
  inferModelStatusFromPayload,
  isScheduledTaskMissing
} from "./parsers";

const ALWAYS_ON_TASK_NAME = "OpenClawDesktopAlwaysOnGateway";
const NODE_INSTALL_OK_EXIT_CODES = [3010];

export class EnvironmentService {
  private resolvedOpenClawCommand = "";

  public async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    const status: EnvironmentStatus = {
      checkedAt: new Date().toISOString(),
      platform: process.platform,
      isWindows: process.platform === "win32",
      nodeInstalled: false,
      npmInstalled: false,
      openClawInstalled: false,
      gatewayRunning: false,
      notes: []
    };

    if (!status.isWindows) {
      status.notes.push("Setup checks are unavailable in this environment.");
      return status;
    }

    const runtime = await this.getNodeRuntimeStatus();
    status.nodeInstalled = runtime.nodeInstalled;
    status.npmInstalled = runtime.npmInstalled;

    if (!status.nodeInstalled || !status.npmInstalled) {
      status.notes.push("Node.js LTS runtime is not ready.");
      if (!status.nodeInstalled) {
        status.notes.push("node command is missing.");
      }
      if (!status.npmInstalled) {
        status.notes.push("npm command is missing.");
      }
      return status;
    }

    status.openClawInstalled = await this.isOpenClawAvailable();
    if (!status.openClawInstalled) {
      status.notes.push("OpenClaw CLI not found on native Windows path.");
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
    if (result.code === 3010) {
      return true;
    }

    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return /reboot|restart/.test(output);
  }

  private async installNodeRuntimeInternal(
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    if (process.platform !== "win32") {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Native Node runtime setup is only available on Windows."
      };
    }

    const runtime = await this.getNodeRuntimeStatus();
    if (runtime.nodeInstalled && runtime.npmInstalled) {
      return {
        ok: true,
        code: 0,
        stdout: "Node.js runtime already installed.",
        stderr: ""
      };
    }

    onLog?.("Installing Node.js LTS runtime on Windows...", "stdout");

    const wingetResult = await this.installNodeWithWinget(onLog);
    if (wingetResult.ok) {
      return this.verifyNodeRuntimeInstalled(wingetResult, onLog);
    }

    onLog?.("winget install failed or unavailable. Falling back to MSI installer...", "stderr");

    const msiResult = await this.installNodeWithMsiFallback(onLog);
    return this.verifyNodeRuntimeInstalled(msiResult, onLog);
  }

  private async installOpenClawInternal(
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    if (process.platform !== "win32") {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "OpenClaw native install is only available on Windows."
      };
    }

    const runtime = await this.getNodeRuntimeStatus();
    if (!runtime.nodeInstalled || !runtime.npmInstalled) {
      return {
        ok: false,
        code: null,
        stdout: "",
        stderr: "Node.js runtime is missing. Install Node first."
      };
    }

    const prefix = this.getManagedNpmPrefix();
    await mkdir(prefix, { recursive: true });

    const npmFile = this.resolveNpmCommand();
    const npmArgs = ["install", "-g", "openclaw", "--prefix", prefix, "--no-fund", "--no-audit"];
    onLog?.(`Installing OpenClaw to ${prefix}...`, "stdout");

    const result = onLog
      ? await runCommandStreaming(npmFile, npmArgs, {
        env: this.buildCommandEnv(),
        onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
        onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
      })
      : await runCommand(npmFile, npmArgs, { env: this.buildCommandEnv() });

    if (!result.ok) {
      return result;
    }

    const openclawInstalled = await this.isOpenClawAvailable(true);
    if (!openclawInstalled) {
      return {
        ok: false,
        code: result.code,
        stdout: result.stdout,
        stderr: `${result.stderr}\nOpenClaw install finished but executable was not detected.`.trim()
      };
    }

    return result;
  }

  private async installNodeWithWinget(
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$winget = Get-Command winget.exe -ErrorAction SilentlyContinue",
      "if (-not $winget) { Write-Output 'winget.exe not found'; exit 127 }",
      "Write-Output 'Attempting Node.js LTS install via winget (UAC prompt may appear)...'",
      "$process = Start-Process -FilePath 'winget.exe' -ArgumentList @('install','--id','OpenJS.NodeJS.LTS','--exact','--silent','--accept-package-agreements','--accept-source-agreements') -Verb RunAs -PassThru -Wait",
      "Write-Output ('winget exit code: ' + $process.ExitCode)",
      "exit $process.ExitCode"
    ].join("; ");

    if (!onLog) {
      return runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
        okExitCodes: NODE_INSTALL_OK_EXIT_CODES,
        env: this.buildCommandEnv()
      });
    }

    return runCommandStreaming(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        okExitCodes: NODE_INSTALL_OK_EXIT_CODES,
        env: this.buildCommandEnv(),
        onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
        onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
      }
    );
  }

  private async installNodeWithMsiFallback(
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      "Write-Output 'Resolving latest Node.js LTS MSI...'",
      "$index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'",
      "$lts = $index | Where-Object { $_.lts -ne $false -and $_.files -contains 'win-x64-msi' } | Select-Object -First 1",
      "if (-not $lts) { throw 'Could not resolve Node.js LTS release.' }",
      "$version = $lts.version",
      "$msiName = 'node-' + $version + '-x64.msi'",
      "$msiUrl = 'https://nodejs.org/dist/' + $version + '/' + $msiName",
      "$target = Join-Path $env:TEMP $msiName",
      "Write-Output ('Downloading ' + $msiUrl)",
      "Invoke-WebRequest -Uri $msiUrl -OutFile $target",
      "Write-Output 'Running MSI installer (UAC prompt may appear)...'",
      "$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $target, '/qn', '/norestart') -Verb RunAs -PassThru -Wait",
      "Write-Output ('MSI exit code: ' + $process.ExitCode)",
      "exit $process.ExitCode"
    ].join("; ");

    if (!onLog) {
      return runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
        okExitCodes: NODE_INSTALL_OK_EXIT_CODES,
        env: this.buildCommandEnv()
      });
    }

    return runCommandStreaming(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        okExitCodes: NODE_INSTALL_OK_EXIT_CODES,
        env: this.buildCommandEnv(),
        onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
        onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
      }
    );
  }

  private async verifyNodeRuntimeInstalled(
    installResult: CommandResult,
    onLog?: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    if (!installResult.ok) {
      return installResult;
    }

    const runtime = await this.getNodeRuntimeStatus();
    if (runtime.nodeInstalled && runtime.npmInstalled) {
      onLog?.("Node.js runtime is ready.", "stdout");
      return installResult;
    }

    return {
      ok: false,
      code: installResult.code,
      stdout: installResult.stdout,
      stderr: `${installResult.stderr}\nNode.js install completed but node/npm are still unavailable. Restart Windows and retry.`.trim()
    };
  }

  private async getNodeRuntimeStatus(): Promise<{ nodeInstalled: boolean; npmInstalled: boolean }> {
    const nodeCheck = await runCommand(this.resolveNodeCommand(), ["--version"], { env: this.buildCommandEnv() });
    const npmCheck = await runCommand(this.resolveNpmCommand(), ["--version"], { env: this.buildCommandEnv() });
    return {
      nodeInstalled: nodeCheck.ok,
      npmInstalled: npmCheck.ok
    };
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
    const openclawPath = this.getManagedOpenClawPath();
    const command = this.quoteForSingleQuotedPowerShell(openclawPath);
    const script = `if (Test-Path ${command}) { & ${command} gateway start *> $null } else { openclaw gateway start *> $null }`;
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
    const command = await this.resolveOpenClawCommand();
    return runCommand(command, args, { env: this.buildCommandEnv() });
  }

  private async runOpenClawStreaming(
    args: string[],
    onLog: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    const command = await this.resolveOpenClawCommand();
    return runCommandStreaming(command, args, {
      env: this.buildCommandEnv(),
      onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
      onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
    });
  }

  private async isOpenClawAvailable(clearCache = false): Promise<boolean> {
    if (clearCache) {
      this.resolvedOpenClawCommand = "";
    }

    try {
      await this.resolveOpenClawCommand();
      return true;
    } catch {
      return false;
    }
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

  private buildCommandEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const prefix = this.getManagedNpmPrefix();
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const currentPath = env[pathKey] || env.PATH || "";
    env[pathKey] = [prefix, currentPath].filter(Boolean).join(path.delimiter);
    env.PATH = env[pathKey];
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

  private quoteForSingleQuotedPowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
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
