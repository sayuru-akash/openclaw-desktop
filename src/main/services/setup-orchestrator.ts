import { EventEmitter } from "node:events";
import type { SetupProgressEvent, SetupStage, SetupState } from "../../shared/types";
import type { EnvironmentService } from "./environment";
import type { SetupStore } from "./setup-store";

type SetupProgressListener = (event: SetupProgressEvent) => void;

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

      const nodeInstall = await this.environmentService.installNodeRuntimeStreaming((line, stream) => {
        this.emitProgress(status.wslReady ? "installing_runtime" : "installing_wsl", line, stream === "stderr" ? "warning" : "info", stream);
      });

      if (!nodeInstall.ok) {
        const rebootRequired = this.environmentService.rebootRequired(nodeInstall);
        return this.saveState(
          {
            stage: "failed",
            requiresReboot: rebootRequired,
            message: rebootRequired
              ? "WSL setup requested a restart. Restart Windows and continue setup."
              : "WSL/runtime installation failed. Check logs and retry setup."
          },
          "error"
        );
      }

      const rebootRequired = this.environmentService.rebootRequired(nodeInstall);
      const postNodeStatus = await this.environmentService.getEnvironmentStatus();
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
}
