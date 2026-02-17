import type {
  CommandResult,
  EnvironmentStatus,
  WizardAnswer,
  WizardNextResult,
  WizardRunStatus,
  WizardStartParams,
  WizardStartResult,
  WizardStatusResult
} from "../../shared/types";
import { runCommand, runCommandStreaming } from "./command-runner";

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
