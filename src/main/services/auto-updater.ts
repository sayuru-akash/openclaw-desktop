import { app } from "electron";
import type { UpdateStatusEvent } from "../../shared/types";

type StatusListener = (event: UpdateStatusEvent) => void;
const { autoUpdater }: { autoUpdater: any } = require("electron-updater");

export class AutoUpdaterService {
  private readonly listeners = new Set<StatusListener>();
  private status: UpdateStatusEvent = {
    checkedAt: new Date(0).toISOString(),
    state: "idle",
    message: "Idle",
    canInstall: false
  };

  constructor() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    if (!app.isPackaged) {
      this.setStatus({
        state: "unsupported",
        message: "Updates are available only in packaged builds.",
        canInstall: false
      });
      return;
    }

    autoUpdater.on("checking-for-update", () => {
      this.setStatus({
        state: "checking",
        message: "Checking for updates...",
        canInstall: false
      });
    });

    autoUpdater.on("update-available", (info: { version?: string }) => {
      this.setStatus({
        state: "available",
        message: "Update found. Downloading in background...",
        version: info.version,
        canInstall: false
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.setStatus({
        state: "not_available",
        message: "You are up to date.",
        canInstall: false,
        progress: undefined
      });
    });

    autoUpdater.on("download-progress", (progress: { percent: number }) => {
      this.setStatus({
        state: "downloading",
        message: "Downloading update...",
        progress: Number(progress.percent.toFixed(1)),
        canInstall: false
      });
    });

    autoUpdater.on("update-downloaded", (info: { version?: string }) => {
      this.setStatus({
        state: "downloaded",
        message: "Update ready. Install when convenient.",
        version: info.version,
        progress: 100,
        canInstall: true
      });
    });

    autoUpdater.on("error", (error: Error | null) => {
      this.setStatus({
        state: "error",
        message: error?.message || "Update check failed.",
        canInstall: false
      });
    });
  }

  public getStatus(): UpdateStatusEvent {
    return { ...this.status };
  }

  public onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async checkForUpdates(): Promise<UpdateStatusEvent> {
    if (this.status.state === "unsupported") {
      return this.getStatus();
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.setStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
        canInstall: false
      });
    }

    return this.getStatus();
  }

  public installDownloadedUpdate(): void {
    if (this.status.state !== "downloaded") {
      throw new Error("No downloaded update is ready to install.");
    }

    autoUpdater.quitAndInstall(true, true);
  }

  public startBackgroundChecks(): void {
    if (this.status.state === "unsupported") {
      return;
    }

    setTimeout(() => {
      void this.checkForUpdates();
    }, 15000);
  }

  private setStatus(next: Partial<UpdateStatusEvent>): void {
    this.status = {
      ...this.status,
      ...next,
      checkedAt: new Date().toISOString()
    };

    for (const listener of this.listeners) {
      listener(this.getStatus());
    }
  }
}
