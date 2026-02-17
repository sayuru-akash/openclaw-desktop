import type { CommandResult, EnvironmentStatus } from "../../shared/types";
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
}
