import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import type { SetupProgressEvent } from "../shared/types";
import { ConfigStore } from "./services/config-store";
import { EnvironmentService } from "./services/environment";
import { SetupOrchestrator } from "./services/setup-orchestrator";
import { SetupStore } from "./services/setup-store";
import { WindowsStartupService } from "./services/windows-startup";

const environmentService = new EnvironmentService();
let configStore: ConfigStore;
let setupOrchestrator: SetupOrchestrator;
let mainWindow: BrowserWindow | null = null;
const pendingSetupEvents: SetupProgressEvent[] = [];

function resolvePreloadFile(): string {
  return path.join(__dirname, "..", "preload", "preload.js");
}

function resolveRendererFile(): string {
  return path.join(app.getAppPath(), "dist", "renderer", "index.html");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: "OpenClaw Desktop",
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: resolvePreloadFile()
    }
  });

  void mainWindow.loadFile(resolveRendererFile());

  mainWindow.once("ready-to-show", () => {
    flushPendingSetupEvents();
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? "";
    if (url !== currentUrl) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function broadcastSetupProgress(event: SetupProgressEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingSetupEvents.push(event);
    if (pendingSetupEvents.length > 200) {
      pendingSetupEvents.shift();
    }
    return;
  }

  mainWindow.webContents.send("setup:progress", event);
}

function flushPendingSetupEvents(): void {
  if (!mainWindow || mainWindow.isDestroyed() || pendingSetupEvents.length === 0) {
    return;
  }

  for (const event of pendingSetupEvents) {
    mainWindow.webContents.send("setup:progress", event);
  }

  pendingSetupEvents.length = 0;
}

function registerIpcHandlers(): void {
  ipcMain.handle("env:get-status", () => environmentService.getEnvironmentStatus());
  ipcMain.handle("env:install-wsl", () => environmentService.installWsl());
  ipcMain.handle("env:install-openclaw", () => environmentService.installOpenClaw());
  ipcMain.handle("env:run-onboarding", () => environmentService.runOnboarding());

  ipcMain.handle("gateway:status", () => environmentService.gatewayStatus());
  ipcMain.handle("gateway:start", () => environmentService.gatewayStart());
  ipcMain.handle("gateway:stop", () => environmentService.gatewayStop());

  ipcMain.handle("config:load", () => configStore.load());
  ipcMain.handle("config:save", (_event, config) => configStore.save(config));

  ipcMain.handle("setup:get-state", () => setupOrchestrator.getState());
  ipcMain.handle("setup:run-guided", () => setupOrchestrator.runGuidedSetup());
  ipcMain.handle("setup:start-wsl", () => setupOrchestrator.startWslSetup());
  ipcMain.handle("setup:resume", () => setupOrchestrator.resumeAfterReboot());
  ipcMain.handle("setup:restart", () => setupOrchestrator.restartForSetup());
}

async function maybeAutoStartGateway(): Promise<void> {
  const config = await configStore.load();
  if (!config.autoStartGateway) {
    return;
  }

  const status = await environmentService.getEnvironmentStatus();
  if (status.isWindows && status.openClawInstalled && !status.gatewayRunning) {
    void environmentService.gatewayStart();
  }
}

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath("userData"));
  setupOrchestrator = new SetupOrchestrator(
    environmentService,
    new SetupStore(app.getPath("userData")),
    new WindowsStartupService(),
    { isPackaged: app.isPackaged, processExecPath: process.execPath }
  );
  setupOrchestrator.onProgress((event) => {
    broadcastSetupProgress(event);
  });
  registerIpcHandlers();
  await setupOrchestrator.resumeAfterReboot();
  createWindow();
  await maybeAutoStartGateway();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
