import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, RendererApi, SetupProgressEvent } from "../shared/types";

const api: RendererApi = {
  getEnvironmentStatus: () => ipcRenderer.invoke("env:get-status"),
  installWsl: () => ipcRenderer.invoke("env:install-wsl"),
  installOpenClaw: () => ipcRenderer.invoke("env:install-openclaw"),
  runOnboarding: () => ipcRenderer.invoke("env:run-onboarding"),
  gatewayStatus: () => ipcRenderer.invoke("gateway:status"),
  gatewayStart: () => ipcRenderer.invoke("gateway:start"),
  gatewayStop: () => ipcRenderer.invoke("gateway:stop"),
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config: Partial<AppConfig>) => ipcRenderer.invoke("config:save", config),
  getSetupState: () => ipcRenderer.invoke("setup:get-state"),
  runGuidedSetup: () => ipcRenderer.invoke("setup:run-guided"),
  startWslSetup: () => ipcRenderer.invoke("setup:start-wsl"),
  resumeSetup: () => ipcRenderer.invoke("setup:resume"),
  restartForSetup: () => ipcRenderer.invoke("setup:restart"),
  onSetupProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SetupProgressEvent) => {
      listener(payload);
    };

    ipcRenderer.on("setup:progress", handler);
    return () => {
      ipcRenderer.removeListener("setup:progress", handler);
    };
  }
};

contextBridge.exposeInMainWorld("openclaw", api);
