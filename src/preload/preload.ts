import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  RendererApi,
  SetupProgressEvent,
  WizardAnswer,
  WizardStartParams
} from "../shared/types";

const api: RendererApi = {
  getEnvironmentStatus: () => ipcRenderer.invoke("env:get-status"),
  getAlwaysOnGatewayStatus: () => ipcRenderer.invoke("always-on:get-status"),
  setAlwaysOnGatewayEnabled: (enabled: boolean) => ipcRenderer.invoke("always-on:set-enabled", enabled),
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
  },
  wizardStart: (params: WizardStartParams = {}) => ipcRenderer.invoke("wizard:start", params),
  wizardNext: (sessionId: string, answer?: WizardAnswer) => ipcRenderer.invoke("wizard:next", sessionId, answer),
  wizardStatus: (sessionId: string) => ipcRenderer.invoke("wizard:status", sessionId),
  wizardCancel: (sessionId: string) => ipcRenderer.invoke("wizard:cancel", sessionId),
  completeOnboardingFromUi: () => ipcRenderer.invoke("setup:complete-onboarding")
};

contextBridge.exposeInMainWorld("openclaw", api);
