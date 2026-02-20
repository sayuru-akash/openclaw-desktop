import { EventEmitter } from "node:events";
import type { SetupProgressEvent, SetupStage, SetupState } from "../../shared/types";
import { runCommand } from "./command-runner";
import type { EnvironmentService } from "./environment";
import type { SetupStore } from "./setup-store";
import type { WindowsStartupService } from "./windows-startup";

interface SetupOrchestratorOptions {
  isPackaged: boolean;
  processExecPath: string;
}

type SetupProgressListener = (event: SetupProgressEvent) => void;

export class SetupOrchestrator extends EventEmitter {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly setupStore: SetupStore,
    private readonly startupService: WindowsStartupService,
    private readonly options: SetupOrchestratorOptions
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
    this.emitProgress("idle", "Guided setup started.");
    const status = await this.environmentService.getEnvironmentStatus();

    if (!status.isWindows) {
      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          resumeOnLogin: false,
          message: "Guided setup is only available on Windows."
        },
        "error"
      );
    }

    if (!status.wslInstalled) {
      return this.startWslSetup();
    }

    return this.continueOpenClawSetup();
  }

  public async startWslSetup(): Promise<SetupState> {
    if (process.platform !== "win32") {
      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          resumeOnLogin: false,
          message: "WSL setup is only available on Windows."
        },
        "error"
      );
    }

    await this.saveState({
      stage: "installing_wsl",
      requiresReboot: false,
      message: "Requesting admin approval to install WSL."
    });

    let resumeOnLogin = false;

    if (this.options.isPackaged) {
      const registerResult = await this.startupService.registerResumeOnLogin(this.buildResumeCommandLine());
      resumeOnLogin = registerResult.ok;
      if (resumeOnLogin) {
        this.emitProgress("installing_wsl", "Resume on login registered.");
      } else {
        this.emitProgress(
          "installing_wsl",
          "Could not register resume-on-login. Manual reopen after reboot may be required.",
          "warning"
        );
      }
    }

    const installResult = await this.environmentService.installWslElevated();
    const rebootRequired = this.environmentService.rebootRequired(installResult);
    const environmentStatus = await this.environmentService.getEnvironmentStatus();

    if (!installResult.ok) {
      if (resumeOnLogin) {
        await this.startupService.clearResumeOnLogin();
      }

      const virtualizationHint = environmentStatus.notes.some((note) => note.toLowerCase().includes("virtualization"))
        ? "BIOS/UEFI virtualization appears disabled. Enable Intel VT-x/AMD SVM, restart Windows, then retry."
        : "WSL install failed or was cancelled. Retry to continue.";

      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          resumeOnLogin: false,
          message: virtualizationHint
        },
        "error"
      );
    }

    this.emitProgress("installing_wsl", "WSL install command completed.");

    if (rebootRequired || !environmentStatus.wslInstalled) {
      return this.saveState({
        stage: "awaiting_reboot",
        requiresReboot: true,
        resumeOnLogin,
        message: resumeOnLogin
          ? "Restart Windows. OpenClaw Desktop will resume setup after sign-in."
          : "Restart Windows and reopen OpenClaw Desktop to continue setup."
      });
    }

    if (resumeOnLogin) {
      await this.startupService.clearResumeOnLogin();
    }

    return this.continueOpenClawSetup();
  }

  public async resumeAfterReboot(): Promise<SetupState> {
    const current = await this.setupStore.load();
    const shouldCheck = current.stage === "awaiting_reboot" || current.resumeOnLogin;

    if (!shouldCheck) {
      return current;
    }

    await this.saveState({
      stage: "resuming_after_reboot",
      message: "Checking WSL status after reboot."
    });

    const environmentStatus = await this.environmentService.getEnvironmentStatus();
    if (!environmentStatus.wslInstalled) {
      return this.saveState({
        stage: "awaiting_reboot",
        requiresReboot: true,
        message: "WSL still looks unavailable. Restart again or run install one more time."
      });
    }

    if (current.resumeOnLogin) {
      await this.startupService.clearResumeOnLogin();
      this.emitProgress("resuming_after_reboot", "Resume-on-login entry cleared.");
    }

    return this.continueOpenClawSetup();
  }

  public restartForSetup() {
    return runCommand("shutdown.exe", [
      "/r",
      "/t",
      "5",
      "/c",
      "OpenClaw Desktop is resuming setup after restart."
    ]);
  }

  public async completeOnboardingFromUi(): Promise<SetupState> {
    await this.saveState({
      stage: "starting_gateway",
      requiresReboot: false,
      resumeOnLogin: false,
      message: "Finalizing onboarding and verifying gateway."
    });

    const startResult = await this.environmentService.gatewayStartStreaming((line, stream) => {
      this.emitProgress("starting_gateway", line, stream === "stderr" ? "warning" : "info", stream);
    });

    if (!startResult.ok) {
      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          resumeOnLogin: false,
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
          resumeOnLogin: false,
          message: "Onboarding completed but gateway is not reporting healthy yet. Check Gateway Status and retry."
        },
        "warning"
      );
    }

    return this.saveState({
      stage: "completed",
      requiresReboot: false,
      resumeOnLogin: false,
      message: "Setup complete. OpenClaw gateway is running."
    });
  }

  private async continueOpenClawSetup(): Promise<SetupState> {
    const status = await this.environmentService.getEnvironmentStatus();

    if (!status.wslInstalled) {
      return this.saveState({
        stage: "awaiting_reboot",
        requiresReboot: true,
        resumeOnLogin: false,
        message: "WSL is still not available. Restart and retry setup."
      });
    }

    if (!status.distroInstalled) {
      return this.saveState(
        {
          stage: "ready_for_manual_step",
          requiresReboot: false,
          resumeOnLogin: false,
          message: "WSL is installed, but no distro is initialized yet. Open Ubuntu once, complete first-run prompts, then continue setup."
        },
        "warning"
      );
    }

    if (!status.openClawInstalled) {
      await this.saveState({
        stage: "installing_openclaw",
        requiresReboot: false,
        resumeOnLogin: false,
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
            resumeOnLogin: false,
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
      resumeOnLogin: false,
      message: "Starting OpenClaw gateway for UI onboarding..."
    });

    const startResult = await this.environmentService.gatewayStartStreaming((line, stream) => {
      this.emitProgress("starting_gateway", line, stream === "stderr" ? "warning" : "info", stream);
    });

    if (!startResult.ok) {
      return this.saveState(
        {
          stage: "failed",
          requiresReboot: false,
          resumeOnLogin: false,
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
          resumeOnLogin: false,
          message: "Gateway did not report running yet. Use Gateway Status/Start, then open in-app onboarding wizard."
        },
        "warning"
      );
    }

    return this.saveState({
      stage: "ready_for_manual_step",
      requiresReboot: false,
      resumeOnLogin: false,
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

  private buildResumeCommandLine(): string {
    return `"${this.options.processExecPath}" --resume-setup`;
  }
}
