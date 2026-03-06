import { EventEmitter } from "node:events";
import type { CommandResult, SetupProgressEvent, SetupStage, SetupState } from "../../shared/types";
import type { EnvironmentService } from "./environment";
import type { SetupStore } from "./setup-store";

type SetupProgressListener = (event: SetupProgressEvent) => void;
const WSL_USER_SETUP_REQUIRED_MARKER = "WSL_USER_SETUP_REQUIRED";

function resolveRuntimeInstallStage(
  line: string,
  fallback: SetupStage
): SetupStage {
  const normalized = line.toLowerCase();
  if (/username|password|account setup|default unix user/.test(normalized)) {
    return "awaiting_wsl_user_setup";
  }
  if (/homebrew|\bbrew\b/.test(normalized)) {
    return "installing_homebrew";
  }
  if (/node|npm|runtime|apt-get|dependency|dependencies|package/.test(normalized)) {
    return "installing_runtime";
  }
  if (/wsl|ubuntu|distro/.test(normalized)) {
    return "installing_wsl";
  }
  return fallback;
}

export class SetupOrchestrator extends EventEmitter {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly setupStore: SetupStore
  ) {
    super();
  }

  public getState(): Promise<SetupState> {
    return this.setupStore.load();
  }

  public onProgress(listener: SetupProgressListener): () => void {
    this.on("progress", listener);
    return () => {
      this.off("progress", listener);
    };
  }

  public async runGuidedSetup(): Promise<SetupState> {
    this.emitProgress("checking_prereqs", "Guided setup started.");

    const status = await this.environmentService.getEnvironmentStatus();
    if (!status.isWindows) {
      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          message: "Guided setup is only available on Windows."
        },
        "error"
      );
    }

    await this.saveState({
      stage: "checking_prereqs",
      requiresReboot: false,
      message: "Checking WSL prerequisites."
    });

    if (!status.wslReady || !status.nodeInstalled || !status.npmInstalled || !status.brewInstalled) {
      await this.saveState({
        stage: status.wslReady ? "installing_runtime" : "installing_wsl",
        requiresReboot: false,
        message: status.wslReady
          ? "Installing runtime dependencies in WSL (Node, npm, Homebrew)..."
          : `Installing WSL (${status.wslDistro})...`
      });

      let runtimeStage: SetupStage = status.wslReady ? "installing_runtime" : "installing_wsl";
      const nodeInstall = await this.environmentService.installNodeRuntimeStreaming((line, stream) => {
        runtimeStage = resolveRuntimeInstallStage(line, runtimeStage);
        this.emitProgress(runtimeStage, line, stream === "stderr" ? "warning" : "info", stream);
      });

      if (!nodeInstall.ok) {
        const rebootRequired = this.environmentService.rebootRequired(nodeInstall);
        const needsWslUserSetup = nodeInstall.stderr.includes(WSL_USER_SETUP_REQUIRED_MARKER);
        const failureReason = this.extractCommandFailureReason(nodeInstall);
        return this.saveState(
          {
            stage: needsWslUserSetup ? "awaiting_wsl_user_setup" : "failed",
            requiresReboot: rebootRequired,
            message: needsWslUserSetup
              ? "Ubuntu account setup is required. Open Ubuntu, create username/password, then click Resume Setup."
              : rebootRequired
                ? "WSL setup requested a restart. Restart Windows and continue setup."
                : `WSL/runtime installation failed: ${failureReason}`
          },
          needsWslUserSetup ? "warning" : "error"
        );
      }

      const rebootRequired = this.environmentService.rebootRequired(nodeInstall);
      const postNodeStatus = await this.environmentService.getEnvironmentStatus();
      if (!postNodeStatus.wslUserConfigured) {
        return this.saveState(
          {
            stage: "awaiting_wsl_user_setup",
            requiresReboot: false,
            message: "Ubuntu account setup is required. Open Ubuntu, create username/password, then click Resume Setup."
          },
          "warning"
        );
      }

      if (!postNodeStatus.wslReady || !postNodeStatus.nodeInstalled || !postNodeStatus.npmInstalled || !postNodeStatus.brewInstalled) {
        return this.saveState(
          {
            stage: rebootRequired ? "awaiting_reboot" : "failed",
            requiresReboot: rebootRequired,
            message: rebootRequired
              ? "WSL setup requested a restart. Restart Windows, then continue setup."
              : "WSL/runtime install completed but requirements are still missing. Retry setup."
          },
          rebootRequired ? "warning" : "error"
        );
      }

      this.emitProgress("installing_runtime", "WSL runtime is ready (Node, npm, Homebrew).");
    }

    return this.continueOpenClawSetup();
  }

  public async completeOnboardingFromUi(): Promise<SetupState> {
    await this.saveState({
      stage: "starting_gateway",
      requiresReboot: false,
      message: "Finalizing onboarding and verifying gateway in WSL."
    });

    const currentStatus = await this.environmentService.getEnvironmentStatus();
    if (currentStatus.gatewayRunning) {
      return this.saveState({
        stage: "completed",
        requiresReboot: false,
        message: "Setup complete. OpenClaw gateway is running."
      });
    }

    const startResult = await this.environmentService.gatewayStartStreaming((line, stream) => {
      this.emitProgress("starting_gateway", line, stream === "stderr" ? "warning" : "info", stream);
    });

    if (!startResult.ok) {
      return this.saveState(
          {
            stage: "failed",
            requiresReboot: false,
            message: "Gateway start failed after onboarding. Retry Start Gateway and finish again."
          },
          "error"
        );
    }

    const status = await this.environmentService.getEnvironmentStatus();
    if (!status.gatewayRunning) {
      return this.saveState(
          {
            stage: "ready_for_manual_step",
            requiresReboot: false,
            message: "Onboarding completed but gateway is not reporting healthy yet. Check Gateway Status and retry."
          },
          "warning"
        );
    }

    return this.saveState({
      stage: "completed",
      requiresReboot: false,
      message: "Setup complete. OpenClaw gateway is running."
    });
  }

  private async continueOpenClawSetup(): Promise<SetupState> {
    const status = await this.environmentService.getEnvironmentStatus();

    if (!status.wslUserConfigured) {
      return this.saveState(
        {
          stage: "awaiting_wsl_user_setup",
          requiresReboot: false,
          message: "Ubuntu account setup is required. Open Ubuntu, create username/password, then click Resume Setup."
        },
        "warning"
      );
    }

    if (!status.wslReady || !status.nodeInstalled || !status.npmInstalled || !status.brewInstalled) {
      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          message: "WSL runtime is missing (Node, npm, or Homebrew). Install WSL/runtime and rerun setup."
        },
        "error"
      );
    }

    if (!status.openClawInstalled) {
      await this.saveState({
        stage: "installing_openclaw",
        requiresReboot: false,
        message: "Installing OpenClaw in WSL..."
      });

      const installResult = await this.environmentService.installOpenClawStreaming((line, stream) => {
        this.emitProgress(
          "installing_openclaw",
          line,
          stream === "stderr" ? "warning" : "info",
          stream
        );
      });

      if (!installResult.ok) {
        return this.saveState(
          {
            stage: "failed",
            requiresReboot: false,
            message: "OpenClaw installation failed. Check logs and retry guided setup."
          },
          "error"
        );
      }

      this.emitProgress("installing_openclaw", "OpenClaw installation completed.");
    }

    await this.saveState({
      stage: "starting_gateway",
      requiresReboot: false,
      message: "Starting OpenClaw gateway in WSL for UI onboarding..."
    });

    const startResult = await this.environmentService.gatewayStartStreaming((line, stream) => {
      this.emitProgress("starting_gateway", line, stream === "stderr" ? "warning" : "info", stream);
    });

    if (!startResult.ok) {
      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          message: "Gateway start failed. Fix gateway health first, then retry guided setup."
        },
        "error"
      );
    }

    const finalStatus = await this.environmentService.getEnvironmentStatus();
    if (!finalStatus.gatewayRunning) {
      return this.saveState(
        {
          stage: "ready_for_manual_step",
          requiresReboot: false,
          message: "Gateway did not report running yet. Use Gateway Status/Start, then open in-app onboarding wizard."
        },
        "warning"
      );
    }

    return this.saveState({
      stage: "ready_for_manual_step",
      requiresReboot: false,
      message: "Gateway is running. Complete onboarding in the in-app wizard."
    });
  }

  private async saveState(
    next: Partial<SetupState>,
    level: SetupProgressEvent["level"] = "info"
  ): Promise<SetupState> {
    const saved = await this.setupStore.save(next);
    if (next.message) {
      this.emitProgress(saved.stage, next.message, level);
    }
    return saved;
  }

  private emitProgress(
    stage: SetupStage,
    message: string,
    level: SetupProgressEvent["level"] = "info",
    source: SetupProgressEvent["source"] = "setup"
  ): void {
    const event: SetupProgressEvent = {
      timestamp: new Date().toISOString(),
      stage,
      level,
      source,
      message
    };

    this.emit("progress", event);
  }

  private extractCommandFailureReason(result: CommandResult): string {
    const raw = [result.stderr, result.stdout].filter(Boolean).join("\n");
    const normalized = raw.replace(/\u0000/g, "").replace(/\ufeff/g, "").trim();
    if (!normalized) {
      return `Command failed${result.code === null ? "." : ` (code ${result.code}).`}`;
    }

    if (/WSL_USER_SETUP_REQUIRED/i.test(normalized)) {
      return "Ubuntu account setup is required.";
    }
    if (/Wsl\/EnumerateDistros\/Service\/E_ACCESSDENIED|E_ACCESSDENIED|access is denied/i.test(normalized)) {
      return "WSL distro access was denied by Windows permissions in this session.";
    }

    const lines = normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const finalLine = lines[lines.length - 1] || normalized;
    return finalLine.length > 220 ? `${finalLine.slice(0, 217)}...` : finalLine;
  }
}
