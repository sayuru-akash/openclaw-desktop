import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  ManagedChannel,
  RendererApi,
  SetupProgressEvent,
  UpdateStatusEvent,
  WorkspaceEditableFileName,
  WizardAnswer,
  WizardStartParams
} from "../shared/types";

function createRequestId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `gw-${Date.now()}-${random}`;
}

const api: RendererApi = {
  getEnvironmentStatus: () => ipcRenderer.invoke("env:get-status"),
  getChannelStatuses: () => ipcRenderer.invoke("channels:get-status"),
  reconnectChannel: (channel: ManagedChannel) => ipcRenderer.invoke("channels:reconnect", channel),
  disableChannel: (channel: ManagedChannel) => ipcRenderer.invoke("channels:disable", channel),
  configureTelegramBot: (token: string) => ipcRenderer.invoke("telegram:configure", token),
  getModelStatus: () => ipcRenderer.invoke("models:get-status"),
  applyModelSelection: (provider: string, model: string) => ipcRenderer.invoke("models:apply", provider, model),
  saveModelApiKey: (provider: string, apiKey: string) => ipcRenderer.invoke("models:save-api-key", provider, apiKey),
  getWorkspaceFile: (workspacePath: string, fileName: WorkspaceEditableFileName) =>
    ipcRenderer.invoke("workspace-files:get", workspacePath, fileName),
  saveWorkspaceFile: (workspacePath: string, fileName: WorkspaceEditableFileName, content: string) =>
    ipcRenderer.invoke("workspace-files:save", workspacePath, fileName, content),
  getAlwaysOnGatewayStatus: () => ipcRenderer.invoke("always-on:get-status"),
  setAlwaysOnGatewayEnabled: (enabled: boolean) => ipcRenderer.invoke("always-on:set-enabled", enabled),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installDownloadedUpdate: () => ipcRenderer.invoke("update:install"),
  installNodeRuntime: () => ipcRenderer.invoke("env:install-node"),
  installNodeRuntimeStreaming: () => ipcRenderer.invoke("env:install-node-stream"),
  openWslUserSetup: () => ipcRenderer.invoke("env:open-wsl-user-setup"),
  restartComputer: () => ipcRenderer.invoke("env:restart-computer"),
  installOpenClaw: () => ipcRenderer.invoke("env:install-openclaw"),
  installOpenClawStreaming: () => ipcRenderer.invoke("env:install-openclaw-stream"),
  runOnboarding: () => ipcRenderer.invoke("env:run-onboarding"),
  gatewayStatus: () => ipcRenderer.invoke("gateway:status"),
  gatewayStart: () => ipcRenderer.invoke("gateway:start"),
  gatewayStartStreaming: () => ipcRenderer.invoke("gateway:start-stream"),
  gatewayStop: () => ipcRenderer.invoke("gateway:stop"),
  gatewayCall: async (method: string, params?: unknown) => {
    const requestId = createRequestId();
    const startedAt = Date.now();
    console.info("[preload]", { area: "gateway", event: "call:start", requestId, method });
    try {
      const result = await ipcRenderer.invoke("gateway:call", method, params ?? {}, requestId);
      console.info("[preload]", {
        area: "gateway",
        event: "call:success",
        requestId,
        method,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[preload]", {
        area: "gateway",
        event: "call:error",
        requestId,
        method,
        durationMs: Date.now() - startedAt,
        message
      });
      throw error;
    }
  },
  openAuthSignIn: () => ipcRenderer.invoke("auth:open-signin"),
  runAuthHandoff: () => ipcRenderer.invoke("auth:handoff"),
  getAuthSessionStatus: () => ipcRenderer.invoke("auth:get-session"),
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config: Partial<AppConfig>) => ipcRenderer.invoke("config:save", config),
  getSetupState: () => ipcRenderer.invoke("setup:get-state"),
  runGuidedSetup: () => ipcRenderer.invoke("setup:run-guided"),
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
