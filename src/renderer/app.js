const CONTROL_UI_URL = "http://127.0.0.1:18789/";

const byId = (id) => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element;
};

const statusElements = {
  platform: byId("platformValue"),
  wsl: byId("wslValue"),
  distro: byId("distroValue"),
  systemd: byId("systemdValue"),
  openclaw: byId("openClawValue"),
  gateway: byId("gatewayValue"),
  setupStage: byId("setupStageValue")
};

const actionButtons = {
  guidedSetup: byId("guidedSetupButton"),
  installWsl: byId("installWslButton"),
  installOpenClaw: byId("installOpenClawButton"),
  runOnboarding: byId("runOnboardingButton"),
  gatewayStatus: byId("gatewayStatusButton"),
  gatewayStart: byId("gatewayStartButton"),
  gatewayStop: byId("gatewayStopButton"),
  resumeSetup: byId("resumeSetupButton"),
  restartNow: byId("restartNowButton")
};

const workspaceButtons = {
  showSetup: byId("showSetupButton"),
  showControl: byId("showControlButton")
};

const controlButtons = {
  reload: byId("reloadControlButton"),
  retryGateway: byId("retryGatewayButton"),
  backToSetup: byId("backToSetupButton")
};

const setupWorkspace = byId("setupWorkspace");
const controlWorkspace = byId("controlWorkspace");
const controlStatus = byId("controlStatus");
const controlFallback = byId("controlFallback");
const controlWebview = byId("controlWebview");
const notesList = byId("notesList");
const logOutput = byId("logOutput");

let lastEnvironmentStatus = null;
let lastSetupState = null;
let activeWorkspace = "setup";
let removeSetupProgressListener = null;

function setStatus(element, label, tone) {
  element.textContent = label;
  element.classList.remove("ok", "warn", "bad");

  if (tone === "ok") {
    element.classList.add("ok");
  } else if (tone === "warn") {
    element.classList.add("warn");
  } else if (tone === "bad") {
    element.classList.add("bad");
  }
}

function appendLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logOutput.textContent = `${line}\n${logOutput.textContent}`;
}

function summarizeCommandResult(title, result) {
  const summary = `${title}: ${result.ok ? "ok" : "failed"}${result.code === null ? "" : ` (code ${result.code})`}`;
  const details = [result.stdout, result.stderr].map((item) => item.trim()).filter(Boolean).join("\n");
  appendLog(details ? `${summary}\n${details}` : summary);
}

function renderSetupProgressEvent(event) {
  const sourceLabel = event.source === "setup" ? "" : ` ${event.source}`;
  appendLog(`Setup [${event.stage}${sourceLabel}] ${event.message}`);

  setStatus(statusElements.setupStage, setupStageLabel(event.stage), setupStageTone(event.stage));
  if (!lastSetupState) {
    lastSetupState = { stage: event.stage, requiresReboot: false };
  } else {
    lastSetupState.stage = event.stage;
  }

  if (event.stage === "completed") {
    void runEnvironmentCheck();
  }
}

function renderNotes(notes) {
  notesList.innerHTML = "";

  if (!notes.length) {
    const item = document.createElement("li");
    item.textContent = "All key checks passed.";
    notesList.appendChild(item);
    return;
  }

  for (const note of notes) {
    const item = document.createElement("li");
    item.textContent = note;
    notesList.appendChild(item);
  }
}

function setupStageLabel(stage) {
  if (stage === "installing_wsl") {
    return "Installing WSL";
  }
  if (stage === "awaiting_reboot") {
    return "Awaiting Reboot";
  }
  if (stage === "resuming_after_reboot") {
    return "Resuming";
  }
  if (stage === "installing_openclaw") {
    return "Installing OpenClaw";
  }
  if (stage === "running_onboarding") {
    return "Onboarding";
  }
  if (stage === "starting_gateway") {
    return "Starting Gateway";
  }
  if (stage === "ready_for_manual_step") {
    return "Manual Step Needed";
  }
  if (stage === "completed") {
    return "Completed";
  }
  if (stage === "failed") {
    return "Needs Attention";
  }
  return "Not Started";
}

function setupStageTone(stage) {
  if (stage === "completed") {
    return "ok";
  }
  if (stage === "failed") {
    return "bad";
  }
  return "warn";
}

function setWorkspace(workspace) {
  activeWorkspace = workspace;
  const showingControl = workspace === "control";

  setupWorkspace.classList.toggle("hidden", showingControl);
  controlWorkspace.classList.toggle("hidden", !showingControl);

  workspaceButtons.showSetup.classList.toggle("primary", !showingControl);
  workspaceButtons.showControl.classList.toggle("primary", showingControl);
}

function isControlReady(status) {
  return Boolean(status && status.isWindows && status.openClawInstalled && status.gatewayRunning);
}

function updateControlSurface() {
  const ready = isControlReady(lastEnvironmentStatus);

  if (!ready) {
    controlStatus.textContent = "Gateway is not ready yet.";
    controlFallback.classList.remove("hidden");
    controlButtons.reload.disabled = true;
    controlButtons.retryGateway.disabled = false;
    if (controlWebview.getAttribute("src") !== "about:blank") {
      controlWebview.setAttribute("src", "about:blank");
    }
    return;
  }

  controlStatus.textContent = `Connected to ${CONTROL_UI_URL}`;
  controlFallback.classList.add("hidden");
  controlButtons.reload.disabled = false;
  controlButtons.retryGateway.disabled = false;

  if (controlWebview.getAttribute("src") !== CONTROL_UI_URL) {
    controlWebview.setAttribute("src", CONTROL_UI_URL);
  }
}

function maybeAutoHandoffToControl() {
  if (!isControlReady(lastEnvironmentStatus)) {
    if (activeWorkspace === "control") {
      updateControlSurface();
    }
    return;
  }

  if (activeWorkspace !== "control") {
    setWorkspace("control");
    appendLog("Gateway is ready. Switched to in-app OpenClaw Control.");
  }

  updateControlSurface();
}

function renderSetupState(setupState) {
  lastSetupState = setupState;
  setStatus(statusElements.setupStage, setupStageLabel(setupState.stage), setupStageTone(setupState.stage));
  applyActionAvailability(lastEnvironmentStatus, setupState);
}

function renderEnvironment(status) {
  lastEnvironmentStatus = status;
  setStatus(statusElements.platform, status.platform, status.isWindows ? "ok" : "bad");
  setStatus(statusElements.wsl, status.wslInstalled ? "Installed" : "Missing", status.wslInstalled ? "ok" : "bad");
  setStatus(statusElements.distro, status.distroInstalled ? "Ready" : "Missing", status.distroInstalled ? "ok" : "warn");
  setStatus(statusElements.systemd, status.systemdEnabled ? "Enabled" : "Not enabled", status.systemdEnabled ? "ok" : "warn");
  setStatus(statusElements.openclaw, status.openClawInstalled ? "Installed" : "Missing", status.openClawInstalled ? "ok" : "warn");
  setStatus(statusElements.gateway, status.gatewayRunning ? "Running" : "Stopped", status.gatewayRunning ? "ok" : "warn");
  renderNotes(status.notes);
  applyActionAvailability(status, lastSetupState);
  maybeAutoHandoffToControl();
}

function applyActionAvailability(status, setupState) {
  if (!status) {
    return;
  }

  const inProgressStageSet = new Set([
    "installing_wsl",
    "resuming_after_reboot",
    "installing_openclaw",
    "running_onboarding",
    "starting_gateway"
  ]);
  const inProgress = Boolean(setupState && inProgressStageSet.has(setupState.stage));

  actionButtons.guidedSetup.disabled = !status.isWindows || inProgress;
  actionButtons.installWsl.disabled = !status.isWindows || status.wslInstalled || inProgress;
  actionButtons.installOpenClaw.disabled = inProgress || !(status.isWindows && status.wslInstalled && status.distroInstalled);
  actionButtons.runOnboarding.disabled = inProgress || !status.openClawInstalled;
  actionButtons.gatewayStatus.disabled = inProgress || !status.openClawInstalled;
  actionButtons.gatewayStart.disabled = inProgress || !status.openClawInstalled;
  actionButtons.gatewayStop.disabled = inProgress || !status.openClawInstalled;
  actionButtons.resumeSetup.disabled = !(setupState && setupState.stage === "awaiting_reboot");
  actionButtons.restartNow.disabled = inProgress || !(setupState && setupState.requiresReboot);
}

async function withBusy(button, task) {
  const originalLabel = button.textContent;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.textContent = "Working...";

  try {
    await task();
  } finally {
    button.textContent = originalLabel;
    if (lastEnvironmentStatus) {
      applyActionAvailability(lastEnvironmentStatus, lastSetupState);
    } else {
      button.disabled = wasDisabled;
    }
  }
}

async function loadConfig() {
  const config = await window.openclaw.loadConfig();
  byId("profileName").value = config.profileName;
  byId("workspacePath").value = config.workspacePath;
  byId("autoStartGateway").checked = Boolean(config.autoStartGateway);
  appendLog("Configuration loaded.");
}

async function saveConfig() {
  const profileName = byId("profileName").value.trim();
  const workspacePath = byId("workspacePath").value.trim();
  const autoStartGateway = byId("autoStartGateway").checked;

  const config = await window.openclaw.saveConfig({
    profileName: profileName || "Default",
    workspacePath,
    autoStartGateway
  });

  appendLog(`Configuration saved (${config.updatedAt}).`);
}

async function runEnvironmentCheck() {
  appendLog("Running environment checks...");
  const status = await window.openclaw.getEnvironmentStatus();
  renderEnvironment(status);
  appendLog("Environment checks completed.");
}

async function refreshSetupState(logMessage = false) {
  const setupState = await window.openclaw.getSetupState();
  renderSetupState(setupState);

  if (logMessage && setupState.message) {
    appendLog(`Setup: ${setupState.message}`);
  }

  return setupState;
}

async function openControlWorkspace() {
  setWorkspace("control");
  await runEnvironmentCheck();
  await refreshSetupState();
  updateControlSurface();
}

function wireControlEvents() {
  controlWebview.addEventListener("dom-ready", () => {
    if (controlWebview.getAttribute("src") === CONTROL_UI_URL) {
      controlStatus.textContent = "Control UI loaded.";
    }
  });

  controlWebview.addEventListener("did-fail-load", (event) => {
    if (event.errorCode === -3) {
      return;
    }

    controlStatus.textContent = "Could not load embedded Control UI.";
    controlFallback.classList.remove("hidden");
    appendLog(`Control UI load failed (${event.errorCode}): ${event.errorDescription}`);
  });
}

function wireActions() {
  workspaceButtons.showSetup.addEventListener("click", () => {
    setWorkspace("setup");
  });

  workspaceButtons.showControl.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, openControlWorkspace);
  });

  byId("guidedSetupButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      appendLog("Starting guided setup. This will install WSL, set up OpenClaw, and start gateway.");
      const setupState = await window.openclaw.runGuidedSetup();
      renderSetupState(setupState);
      appendLog(`Setup: ${setupState.message}`);

      if (setupState.requiresReboot) {
        appendLog("Restart is required. Use 'Restart Windows Now' or reboot manually.");
      }

      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("checkEnvButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("installWslButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      appendLog("Starting elevated WSL setup. Approve the Windows UAC prompt when asked.");
      const setupState = await window.openclaw.startWslSetup();
      renderSetupState(setupState);
      appendLog(`Setup: ${setupState.message}`);

      if (setupState.requiresReboot) {
        appendLog("Restart is required. Use 'Restart Windows Now' or reboot manually.");
      }

      await runEnvironmentCheck();
    });
  });

  byId("installOpenClawButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      appendLog("Installing OpenClaw in WSL...");
      const result = await window.openclaw.installOpenClaw();
      summarizeCommandResult("OpenClaw install", result);
      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("runOnboardingButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      appendLog("Running OpenClaw onboarding...");
      const result = await window.openclaw.runOnboarding();
      summarizeCommandResult("OpenClaw onboarding", result);
      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("gatewayStatusButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      const result = await window.openclaw.gatewayStatus();
      summarizeCommandResult("Gateway status", result);
      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("gatewayStartButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      const result = await window.openclaw.gatewayStart();
      summarizeCommandResult("Gateway start", result);
      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("gatewayStopButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      const result = await window.openclaw.gatewayStop();
      summarizeCommandResult("Gateway stop", result);
      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("resumeSetupButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      appendLog("Continuing guided setup after reboot...");
      const setupState = await window.openclaw.resumeSetup();
      renderSetupState(setupState);
      appendLog(`Setup: ${setupState.message}`);
      await runEnvironmentCheck();
      await refreshSetupState();
    });
  });

  byId("restartNowButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      appendLog("Requesting Windows restart in 5 seconds...");
      const result = await window.openclaw.restartForSetup();
      summarizeCommandResult("Restart request", result);
    });
  });

  byId("saveConfigButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, saveConfig);
  });

  controlButtons.reload.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      updateControlSurface();
      if (controlWebview.getAttribute("src") === CONTROL_UI_URL) {
        controlWebview.reload();
        appendLog("Reloaded embedded Control UI.");
      } else {
        appendLog("Control UI not loaded because gateway is not ready.");
      }
    });
  });

  controlButtons.retryGateway.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      appendLog("Starting gateway and retrying embedded Control UI...");
      const result = await window.openclaw.gatewayStart();
      summarizeCommandResult("Gateway start", result);
      await openControlWorkspace();
    });
  });

  controlButtons.backToSetup.addEventListener("click", () => {
    setWorkspace("setup");
  });
}

async function bootstrap() {
  try {
    removeSetupProgressListener = window.openclaw.onSetupProgress((event) => {
      renderSetupProgressEvent(event);
    });

    window.addEventListener("beforeunload", () => {
      if (typeof removeSetupProgressListener === "function") {
        removeSetupProgressListener();
      }
    });

    wireControlEvents();
    wireActions();
    await loadConfig();
    await refreshSetupState(true);
    await runEnvironmentCheck();
    setWorkspace("setup");
    maybeAutoHandoffToControl();
  } catch (error) {
    appendLog(`Bootstrap error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void bootstrap();
