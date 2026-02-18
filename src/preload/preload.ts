import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  ManagedChannel,
  RendererApi,
  SetupProgressEvent,
  UpdateStatusEvent,
  WizardAnswer,
  WizardStartParams
} from "../shared/types";

const api: RendererApi = {
  getEnvironmentStatus: () => ipcRenderer.invoke("env:get-status"),
  getChannelStatuses: () => ipcRenderer.invoke("channels:get-status"),
  reconnectChannel: (channel: ManagedChannel) => ipcRenderer.invoke("channels:reconnect", channel),
  disableChannel: (channel: ManagedChannel) => ipcRenderer.invoke("channels:disable", channel),
  configureTelegramBot: (token: string) => ipcRenderer.invoke("telegram:configure", token),
  getModelStatus: () => ipcRenderer.invoke("models:get-status"),
  applyModelSelection: (provider: string, model: string) => ipcRenderer.invoke("models:apply", provider, model),
  getAlwaysOnGatewayStatus: () => ipcRenderer.invoke("always-on:get-status"),
  setAlwaysOnGatewayEnabled: (enabled: boolean) => ipcRenderer.invoke("always-on:set-enabled", enabled),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installDownloadedUpdate: () => ipcRenderer.invoke("update:install"),
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
  onUpdateStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: UpdateStatusEvent) => {
      listener(payload);
    };

    ipcRenderer.on("update:status", handler);
    return () => {
      ipcRenderer.removeListener("update:status", handler);
    };
  },
  wizardStart: (params: WizardStartParams = {}) => ipcRenderer.invoke("wizard:start", params),
  wizardNext: (sessionId: string, answer?: WizardAnswer) => ipcRenderer.invoke("wizard:next", sessionId, answer),
  wizardStatus: (sessionId: string) => ipcRenderer.invoke("wizard:status", sessionId),
  wizardCancel: (sessionId: string) => ipcRenderer.invoke("wizard:cancel", sessionId),
  completeOnboardingFromUi: () => ipcRenderer.invoke("setup:complete-onboarding")
};

contextBridge.exposeInMainWorld("openclaw", api);
