import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
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
let tray: Tray | null = null;
let isQuitting = false;
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

  mainWindow.on("close", (event) => {
    if (process.platform !== "win32" || isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });
}

function buildTrayIcon() {
  const image = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAM1BMVEVHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAx8qYvAAAAEHRSTlMAECAwQFBgcICPn6+/z9/vH+xR+AAAAG9JREFUGNNjYIACRkYmZi5uHh4+AXY2bi4eHj4gHj4Bdg5uHm4efg5+QW4eQR4+QX4BQVFBYVFRSVlFXUNTTX1Dc0NTS1tbR1dPX4BLS0dXR09fQMjI20jIyNVQ2NjarA0NfVAADEQQYlF9MZqwAAAABJRU5ErkJggg=="
  );

  return process.platform === "win32" ? image.resize({ width: 16, height: 16 }) : image;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

function createTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray(buildTrayIcon());
  tray.setToolTip("OpenClaw Desktop");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open OpenClaw Desktop",
        click: () => {
          showMainWindow();
        }
      },
      {
        type: "separator"
      },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );

  tray.on("click", () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }

    showMainWindow();
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
  ipcMain.handle("always-on:get-status", () => environmentService.getAlwaysOnGatewayStatus());
  ipcMain.handle("always-on:set-enabled", (_event, enabled) =>
    environmentService.setAlwaysOnGatewayEnabled(Boolean(enabled))
  );
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
  ipcMain.handle("setup:complete-onboarding", () => setupOrchestrator.completeOnboardingFromUi());

  ipcMain.handle("wizard:start", (_event, params) => environmentService.wizardStart(params));
  ipcMain.handle("wizard:next", (_event, sessionId, answer) => environmentService.wizardNext(sessionId, answer));
  ipcMain.handle("wizard:status", (_event, sessionId) => environmentService.wizardStatus(sessionId));
  ipcMain.handle("wizard:cancel", (_event, sessionId) => environmentService.wizardCancel(sessionId));
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
  createTray();
  await maybeAutoStartGateway();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 || !mainWindow) {
      createWindow();
      return;
    }

    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});
