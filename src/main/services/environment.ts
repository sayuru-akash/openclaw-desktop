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
import os from "node:os";
import { runCommand, runCommandStreaming } from "./command-runner";
import {
  inferChannelStatusFromPayload,
  inferModelStatusFromPayload,
  isScheduledTaskMissing,
  isWindowsBuildSupported,
  parseWindowsBuildFromRelease
} from "./parsers";

const ALWAYS_ON_TASK_NAME = "OpenClawDesktopAlwaysOnGateway";

export class EnvironmentService {
  public async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    const status: EnvironmentStatus = {
      checkedAt: new Date().toISOString(),
      platform: process.platform,
      isWindows: process.platform === "win32",
      wslInstalled: false,
      distroInstalled: false,
      systemdEnabled: false,
      openClawInstalled: false,
      gatewayRunning: false,
      notes: []
    };

    if (!status.isWindows) {
      status.notes.push("This app is designed for Windows. Setup checks are disabled on non-Windows hosts.");
      return status;
    }

    const windowsBuild = parseWindowsBuildFromRelease(os.release());
    if (!isWindowsBuildSupported(windowsBuild)) {
      status.notes.push("Windows build may be too old for seamless WSL setup. Prefer Windows 10 build 19041+ or Windows 11.");
    }

    const wslStatus = await runCommand("wsl.exe", ["--status"]);
    status.wslInstalled = wslStatus.ok;
    if (!wslStatus.ok) {
      status.notes.push("WSL is not available yet.");
      return status;
    }

    const distroStatus = await runCommand("wsl.exe", ["-l", "-q"]);
    const distros = distroStatus.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    status.distroInstalled = distros.length > 0;
    if (!status.distroInstalled) {
      status.notes.push("WSL is installed but no Linux distro is initialized.");
      return status;
    }

    const systemdStatus = await this.runInWsl("grep -E '^systemd=true' /etc/wsl.conf");
    status.systemdEnabled = systemdStatus.ok;
    if (!status.systemdEnabled) {
      status.notes.push("systemd does not look enabled in /etc/wsl.conf.");
    }

    const openClawStatus = await this.runInWsl("command -v openclaw >/dev/null 2>&1");
    status.openClawInstalled = openClawStatus.ok;
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

  public installWsl(): Promise<CommandResult> {
    return runCommand("wsl.exe", ["--install"], { okExitCodes: [3010] });
  }

  public installWslElevated(): Promise<CommandResult> {
    const installScript = [
      "$process = Start-Process -FilePath 'wsl.exe' -ArgumentList '--install' -Verb RunAs -PassThru -Wait;",
      "exit $process.ExitCode"
    ].join(" ");

    return runCommand(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", installScript],
      { okExitCodes: [3010] }
    );
  }

  public installOpenClaw(): Promise<CommandResult> {
    return this.runInWsl("curl -fsSL https://openclaw.ai/install.sh | bash");
  }

  public installOpenClawStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    return this.runInWslStreaming("curl -fsSL https://openclaw.ai/install.sh | bash", onLog);
  }

  public runOnboarding(): Promise<CommandResult> {
    return this.runInWsl("openclaw onboard --install-daemon");
  }

  public runOnboardingStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    return this.runInWslStreaming("openclaw onboard --install-daemon", onLog);
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
    return this.runInWsl("openclaw gateway status");
  }

  public gatewayStart(): Promise<CommandResult> {
    return this.runInWsl("openclaw gateway start");
  }

  public gatewayStartStreaming(onLog: (line: string, stream: "stdout" | "stderr") => void): Promise<CommandResult> {
    return this.runInWslStreaming("openclaw gateway start", onLog);
  }

  public gatewayStop(): Promise<CommandResult> {
    return this.runInWsl("openclaw gateway stop");
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
    const command = channel === "whatsapp"
      ? "openclaw channels login --channel whatsapp"
      : "openclaw channels login --channel telegram";

    const result = await this.runInWsl(command);
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || `Failed to reconnect ${channel}.`);
    }

    return this.readChannelStatus(channel);
  }

  public async disableChannel(channel: ManagedChannel): Promise<ChannelStatusItem> {
    const commands = [
      `openclaw channels logout --channel ${channel}`,
      `openclaw channels remove --channel ${channel} --delete`,
      `openclaw channels remove --channel ${channel}`
    ];

    let lastError = "";
    for (const command of commands) {
      const result = await this.runInWsl(command);
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

    const tokenArg = this.escapeShellSingleQuoted(normalizedToken);
    const commands = [
      `openclaw channels add --channel telegram --token ${tokenArg}`,
      `openclaw channels login --channel telegram --token ${tokenArg}`
    ];

    let lastError = "";
    for (const command of commands) {
      const result = await this.runInWsl(command);
      if (result.ok) {
        return this.readChannelStatus("telegram");
      }
      lastError = result.stderr || result.stdout || lastError;
    }

    throw new Error(lastError || "Unable to configure Telegram bot token.");
  }

  public async getModelStatus(): Promise<ModelStatusResult> {
    const result = await this.runInWsl("openclaw models list --json");
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
      detail: inferred.detail
    };
  }

  public async applyModelSelection(provider: string, model: string): Promise<ModelStatusResult> {
    const normalizedProvider = provider.trim();
    const normalizedModel = model.trim();

    if (!normalizedProvider || !normalizedModel) {
      throw new Error("Provider and model are required.");
    }

    const providerArg = this.escapeShellSingleQuoted(normalizedProvider);
    const modelArg = this.escapeShellSingleQuoted(normalizedModel);
    const result = await this.runInWsl(
      `openclaw models set --provider ${providerArg} --model ${modelArg} --json`
    );

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

    if (query.code !== 0) {
      return {
        supported: true,
        enabled: false,
        taskName: ALWAYS_ON_TASK_NAME,
        detail: `Unable to read task status: ${query.stderr || query.stdout || "Unknown error"}`
      };
    }

    if (!query.ok) {
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

    if (deleteResult.code !== 0) {
      throw new Error(deleteResult.stderr || deleteResult.stdout || "Failed to delete always-on gateway task.");
    }

    if (!deleteResult.ok) {
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

  private runInWsl(command: string): Promise<CommandResult> {
    return runCommand("wsl.exe", ["bash", "-lc", command]);
  }

  private async readChannelStatus(channel: ManagedChannel): Promise<ChannelStatusItem> {
    const jsonCommand = `openclaw channels status --channel ${channel} --json`;
    const jsonResult = await this.runInWsl(jsonCommand);

    if (jsonResult.ok) {
      try {
        const payload = this.parseJsonOutput(jsonResult.stdout, jsonResult.stderr);
        return inferChannelStatusFromPayload(channel, payload, jsonResult.stdout);
      } catch {
        return inferChannelStatusFromPayload(channel, jsonResult.stdout, jsonResult.stdout);
      }
    }

    const fallback = await this.runInWsl(`openclaw channels status --channel ${channel}`);
    return inferChannelStatusFromPayload(
      channel,
      fallback.ok ? fallback.stdout : `${fallback.stdout}\n${fallback.stderr}`,
      fallback.ok ? fallback.stdout : `${fallback.stdout}\n${fallback.stderr}`
    );
  }

  private getAlwaysOnTaskAction(): string {
    const gatewayCommand = "openclaw gateway start >/dev/null 2>&1 || true";
    return `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "wsl.exe bash -lc '${gatewayCommand}'"`;
  }

  private async runWizardCall<T>(method: string, params: unknown): Promise<T> {
    const payload = JSON.stringify(params);
    const escapedPayload = this.escapeShellSingleQuoted(payload);
    const command = `openclaw gateway call ${method} --params ${escapedPayload} --json`;
    const result = await this.runInWsl(command);

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

  private runInWslStreaming(
    command: string,
    onLog: (line: string, stream: "stdout" | "stderr") => void
  ): Promise<CommandResult> {
    return runCommandStreaming("wsl.exe", ["bash", "-lc", command], {
      onStdout: (chunk) => this.emitChunkLines(chunk, "stdout", onLog),
      onStderr: (chunk) => this.emitChunkLines(chunk, "stderr", onLog)
    });
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

  private escapeShellSingleQuoted(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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
