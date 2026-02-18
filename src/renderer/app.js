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
  setupStage: byId("setupStageValue"),
  alwaysOnGateway: byId("alwaysOnGatewayValue")
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

const wizardElements = {
  start: byId("wizardStartButton"),
  submit: byId("wizardSubmitButton"),
  cancel: byId("wizardCancelButton"),
  refresh: byId("wizardRefreshButton"),
  complete: byId("wizardCompleteButton"),
  qrScanned: byId("wizardQrScannedButton"),
  sessionLabel: byId("wizardSessionLabel"),
  stepCard: byId("wizardStepCard"),
  stepTitle: byId("wizardStepTitle"),
  stepMeta: byId("wizardStepMeta"),
  stepMessage: byId("wizardStepMessage"),
  guideHint: byId("wizardGuideHint"),
  qrPanel: byId("wizardQrPanel"),
  qrImage: byId("wizardQrImage"),
  qrAscii: byId("wizardQrAscii"),
  qrFallback: byId("wizardQrFallback"),
  qrScanStatus: byId("wizardQrScanStatus"),
  qrChecklist: byId("wizardQrChecklist"),
  checklistOpen: byId("wizardChecklistOpen"),
  checklistLinked: byId("wizardChecklistLinked"),
  checklistScan: byId("wizardChecklistScan"),
  checklistConnected: byId("wizardChecklistConnected"),
  telegramPanel: byId("wizardTelegramPanel"),
  telegramBotfather: byId("wizardTelegramBotfather"),
  telegramToken: byId("wizardTelegramToken"),
  telegramChat: byId("wizardTelegramChat"),
  telegramValidate: byId("wizardTelegramValidate"),
  telegramStatus: byId("wizardTelegramStatus"),
  modelPanel: byId("wizardModelPanel"),
  modelProvider: byId("wizardModelProvider"),
  modelName: byId("wizardModelName"),
  modelCredential: byId("wizardModelCredential"),
  modelProviderValue: byId("wizardModelProviderValue"),
  modelNameValue: byId("wizardModelNameValue"),
  modelStatus: byId("wizardModelStatus"),
  inputContainer: byId("wizardInputContainer"),
  validation: byId("wizardValidationMessage"),
  rawState: byId("wizardRawState")
};

const alwaysOnElements = {
  toggle: byId("alwaysOnGatewayToggle"),
  detail: byId("alwaysOnGatewayDetail")
};

const channelElements = {
  refresh: byId("channelsRefreshButton"),
  whatsappStatus: byId("whatsappChannelStatus"),
  whatsappDetail: byId("whatsappChannelDetail"),
  whatsappReconnect: byId("whatsappReconnectButton"),
  whatsappDisable: byId("whatsappDisableButton"),
  telegramStatus: byId("telegramChannelStatus"),
  telegramDetail: byId("telegramChannelDetail"),
  telegramReconnect: byId("telegramReconnectButton"),
  telegramDisable: byId("telegramDisableButton")
};

const modelManagementElements = {
  refresh: byId("modelRefreshButton"),
  current: byId("modelCurrentStatus"),
  provider: byId("manageModelProvider"),
  model: byId("manageModelName"),
  apply: byId("modelApplyButton")
};

const updateElements = {
  check: byId("updateCheckButton"),
  install: byId("updateInstallButton"),
  status: byId("updateStatusText")
};

const telegramHelperElements = {
  startReconnect: byId("telegramHelperStartButton"),
  copyBotFather: byId("copyBotFatherButton"),
  copyNewBot: byId("copyNewBotCommandButton"),
  token: byId("telegramHelperToken"),
  saveToken: byId("telegramHelperSaveTokenButton"),
  validation: byId("telegramHelperValidation")
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
let removeUpdateStatusListener = null;
let lastAlwaysOnGatewayStatus = null;
let lastChannelStatuses = null;
let lastModelStatus = null;
let lastUpdateStatus = null;
let lastUpdateLogKey = "";
let lastUpdateLoggedProgressBucket = -1;
let wizardSessionId = "";
let currentWizardStep = null;
let currentWizardTemplate = null;
let wizardStatusPollTimer = null;
let lastWizardStatusValue = "";
let currentWizardQrRequired = false;
let wizardQrScanned = false;
let wizardQrStepId = "";
let wizardQrCodeVisible = false;
let wizardPairingConnected = false;
let wizardTelegramActive = false;
let wizardTelegramTokenSaved = false;
let wizardTelegramChatSaved = false;
let wizardTelegramValidated = false;
let wizardModelActive = false;
let wizardModelProvider = "";
let wizardModelName = "";
let wizardModelCredentialSaved = false;

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
  const details = [result.stdout, result.stderr]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
  appendLog(details ? `${summary}\n${details}` : summary);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function setTelegramHelperValidation(message) {
  if (!message) {
    telegramHelperElements.validation.textContent = "";
    telegramHelperElements.validation.classList.add("hidden");
    return;
  }

  telegramHelperElements.validation.textContent = message;
  telegramHelperElements.validation.classList.remove("hidden");
}

function validateTelegramHelperToken(token) {
  if (!token || token.trim().length === 0) {
    return "Enter bot token.";
  }

  const normalized = token.trim();
  if (!/^[0-9]{5,}:[A-Za-z0-9_-]{15,}$/.test(normalized)) {
    return "Token format looks wrong.";
  }

  return "";
}

async function copyToClipboard(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    appendLog(successMessage);
  } catch (error) {
    appendLog(`Copy failed: ${formatError(error)}`);
  }
}

const KNOWN_MODEL_PROVIDERS = [
  { key: "openai", label: "OpenAI" },
  { key: "anthropic", label: "Anthropic" },
  { key: "google", label: "Google" },
  { key: "gemini", label: "Google" },
  { key: "groq", label: "Groq" },
  { key: "ollama", label: "Ollama" },
  { key: "azure", label: "Azure OpenAI" },
  { key: "bedrock", label: "AWS Bedrock" },
  { key: "mistral", label: "Mistral" },
  { key: "deepseek", label: "DeepSeek" }
];

function areValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringifyWizardValue(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function findOptionLabelForValue(step, value) {
  for (const option of step?.options || []) {
    if (areValuesEqual(option.value, value)) {
      return option.label || "";
    }
  }
  return "";
}

function inferProviderLabel(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  const known = KNOWN_MODEL_PROVIDERS.find((provider) => lower.includes(provider.key));
  if (known) {
    return known.label;
  }

  return normalized;
}

function inferProviderFromModelName(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("gpt-") || normalized.startsWith("o1") || normalized.startsWith("o3")) {
    return "OpenAI";
  }
  if (normalized.startsWith("claude")) {
    return "Anthropic";
  }
  if (normalized.startsWith("gemini")) {
    return "Google";
  }
  if (normalized.includes("llama")) {
    return "Ollama";
  }
  if (normalized.startsWith("mistral")) {
    return "Mistral";
  }
  if (normalized.startsWith("deepseek")) {
    return "DeepSeek";
  }

  return "";
}

function syncModelStateIntoConfigForm() {
  if (wizardModelProvider) {
    byId("modelProvider").value = wizardModelProvider;
  }

  if (wizardModelName) {
    byId("modelName").value = wizardModelName;
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

function renderAlwaysOnGatewayStatus(status) {
  lastAlwaysOnGatewayStatus = status;

  if (!status.supported) {
    setStatus(statusElements.alwaysOnGateway, "Unsupported", "bad");
    alwaysOnElements.toggle.checked = false;
    alwaysOnElements.toggle.disabled = true;
    alwaysOnElements.detail.textContent = status.detail;
    return;
  }

  setStatus(statusElements.alwaysOnGateway, status.enabled ? "Enabled" : "Disabled", status.enabled ? "ok" : "warn");
  alwaysOnElements.toggle.checked = status.enabled;
  alwaysOnElements.toggle.disabled = false;
  alwaysOnElements.detail.textContent = status.detail;
}

async function refreshAlwaysOnGatewayStatus(logMessage = false) {
  const status = await window.openclaw.getAlwaysOnGatewayStatus();
  renderAlwaysOnGatewayStatus(status);

  if (logMessage) {
    appendLog(`Always-on gateway: ${status.enabled ? "enabled" : "disabled"}. ${status.detail}`);
  }

  return status;
}

function toneForChannel(item) {
  if (item.connected) {
    return "ok";
  }
  if (item.configured) {
    return "warn";
  }
  return "bad";
}

function renderChannelStatuses(payload) {
  lastChannelStatuses = payload;
  const fallback = {
    summary: "Unknown",
    detail: "Not checked.",
    connected: false,
    configured: false
  };

  const whatsapp = (payload.channels || []).find((item) => item.channel === "whatsapp") || fallback;
  const telegram = (payload.channels || []).find((item) => item.channel === "telegram") || fallback;

  setStatus(channelElements.whatsappStatus, whatsapp.summary, toneForChannel(whatsapp));
  channelElements.whatsappDetail.textContent = whatsapp.detail || "No detail.";

  setStatus(channelElements.telegramStatus, telegram.summary, toneForChannel(telegram));
  channelElements.telegramDetail.textContent = telegram.detail || "No detail.";
}

async function refreshChannelStatuses(logMessage = false) {
  const payload = await window.openclaw.getChannelStatuses();
  renderChannelStatuses(payload);
  if (logMessage) {
    appendLog("Channels refreshed.");
  }
  return payload;
}

function renderModelManagementStatus(payload) {
  lastModelStatus = payload;
  const provider = payload.provider || "none";
  const model = payload.model || "none";
  modelManagementElements.current.textContent = `Current: ${provider} / ${model}`;
  modelManagementElements.provider.value = payload.provider || "";
  modelManagementElements.model.value = payload.model || "";
}

async function refreshModelManagementStatus(logMessage = false) {
  const payload = await window.openclaw.getModelStatus();
  renderModelManagementStatus(payload);
  if (logMessage) {
    appendLog(payload.detail);
  }
  return payload;
}

function renderUpdateStatus(event) {
  lastUpdateStatus = event;
  const parts = [event.message];
  if (event.version) {
    parts.push(`v${event.version}`);
  }
  if (typeof event.progress === "number" && event.state === "downloading") {
    parts.push(`${event.progress}%`);
  }

  updateElements.status.textContent = parts.filter(Boolean).join(" - ");
  const canInstall = event.state === "downloaded" && event.canInstall;
  updateElements.install.classList.toggle("hidden", !canInstall);
  updateElements.install.disabled = !canInstall;
}

async function refreshUpdateStatus(logMessage = false) {
  const status = await window.openclaw.getUpdateStatus();
  renderUpdateStatus(status);
  if (logMessage) {
    appendLog(`Update: ${status.message}`);
  }
  return status;
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
  } catch (error) {
    appendLog(`Error: ${formatError(error)}`);
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
  byId("modelProvider").value = config.modelProvider || "";
  byId("modelName").value = config.modelName || "";
  byId("autoStartGateway").checked = Boolean(config.autoStartGateway);
  if (config.modelProvider) {
    wizardModelProvider = config.modelProvider;
  }
  if (config.modelName) {
    wizardModelName = config.modelName;
  }
  appendLog("Configuration loaded.");
}

async function saveConfig() {
  const profileName = byId("profileName").value.trim();
  const workspacePath = byId("workspacePath").value.trim();
  const modelProvider = byId("modelProvider").value.trim();
  const modelName = byId("modelName").value.trim();
  const autoStartGateway = byId("autoStartGateway").checked;

  const config = await window.openclaw.saveConfig({
    profileName: profileName || "Default",
    workspacePath,
    modelProvider,
    modelName,
    autoStartGateway
  });

  appendLog(`Configuration saved (${config.updatedAt}).`);
}

async function runEnvironmentCheck() {
  appendLog("Running environment checks...");
  const status = await window.openclaw.getEnvironmentStatus();
  renderEnvironment(status);
  await refreshAlwaysOnGatewayStatus();
  if (status.openClawInstalled) {
    try {
      await refreshChannelStatuses();
    } catch (error) {
      appendLog(`Channel status check failed: ${formatError(error)}`);
    }

    try {
      await refreshModelManagementStatus();
    } catch (error) {
      appendLog(`Model status check failed: ${formatError(error)}`);
    }
  } else {
    renderChannelStatuses({
      checkedAt: new Date().toISOString(),
      channels: [
        { channel: "whatsapp", configured: false, connected: false, summary: "Unavailable", detail: "Install OpenClaw first." },
        { channel: "telegram", configured: false, connected: false, summary: "Unavailable", detail: "Install OpenClaw first." }
      ]
    });
    renderModelManagementStatus({
      checkedAt: new Date().toISOString(),
      provider: "",
      model: "",
      availableProviders: [],
      detail: "Install OpenClaw first."
    });
  }
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

function setWizardSessionLabel(text) {
  wizardElements.sessionLabel.textContent = text;
}

function setWizardRawState(payload) {
  wizardElements.rawState.textContent = safeStringify(payload);
}

function setWizardGuideHint(message) {
  if (!message) {
    wizardElements.guideHint.textContent = "";
    wizardElements.guideHint.classList.add("hidden");
    return;
  }

  wizardElements.guideHint.textContent = message;
  wizardElements.guideHint.classList.remove("hidden");
}

function setWizardQrScanStatus(done, message) {
  wizardElements.qrScanStatus.textContent = message;
  wizardElements.qrScanStatus.classList.toggle("done", done);
}

function setChecklistItemState(element, state) {
  element.classList.remove("active", "done");
  const icon = element.querySelector(".wizard-check-icon");

  if (state === "done") {
    element.classList.add("done");
    if (icon) {
      icon.textContent = "✓";
    }
    return;
  }

  if (state === "active") {
    element.classList.add("active");
  }

  if (icon) {
    const fallback = element.dataset.stepIndex || icon.textContent || "";
    icon.textContent = fallback;
  }
}

function renderWizardPairingChecklist() {
  if (!currentWizardQrRequired) {
    wizardElements.qrChecklist.classList.add("hidden");
    return;
  }

  wizardElements.qrChecklist.classList.remove("hidden");

  const openDone = true;
  const linkedDone = wizardQrCodeVisible;
  const scanDone = wizardQrScanned;
  const connectedDone = wizardPairingConnected;

  setChecklistItemState(wizardElements.checklistOpen, openDone ? "done" : "active");
  setChecklistItemState(
    wizardElements.checklistLinked,
    linkedDone ? "done" : openDone ? "active" : "waiting"
  );
  setChecklistItemState(
    wizardElements.checklistScan,
    scanDone ? "done" : linkedDone ? "active" : "waiting"
  );
  setChecklistItemState(
    wizardElements.checklistConnected,
    connectedDone ? "done" : scanDone ? "active" : "waiting"
  );
}

function updateWizardPairingConnectedFromStatus(status) {
  if (!status) {
    return;
  }

  const statusText = String(status.status || "").toLowerCase();
  const errorText = String(status.error || "").toLowerCase();

  if (statusText === "done" || statusText === "completed" || statusText === "success" || statusText === "connected") {
    wizardPairingConnected = true;
    return;
  }

  if (statusText === "error" && errorText.includes("not connected")) {
    wizardPairingConnected = false;
  }
}

function updateWizardPairingConnectedFromStep(step) {
  if (!step) {
    return;
  }

  const blob = getWizardStepBlob(step);
  if (!blob) {
    return;
  }

  if ((blob.includes("connected") || blob.includes("connection ready") || blob.includes("pairing complete")) && !blob.includes("not connected")) {
    wizardPairingConnected = true;
  }
}

function setWizardTelegramStatus(done, message) {
  wizardElements.telegramStatus.textContent = message;
  wizardElements.telegramStatus.classList.toggle("done", done);
}

function resetWizardTelegramPanel() {
  wizardTelegramActive = false;
  wizardTelegramTokenSaved = false;
  wizardTelegramChatSaved = false;
  wizardTelegramValidated = false;
  wizardElements.telegramPanel.classList.add("hidden");
  setWizardTelegramStatus(false, "Status: waiting for Telegram setup steps.");
}

function updateWizardTelegramProgressFromStep(step, template) {
  if (!step || !template || template.intent !== "telegram") {
    return;
  }

  wizardTelegramActive = true;
  const blob = getWizardStepBlob(step);

  if (template.textRole === "bot_token") {
    wizardTelegramTokenSaved = false;
  }

  if (template.textRole === "chat_id") {
    wizardTelegramChatSaved = false;
  }

  if ((blob.includes("connected") || blob.includes("test message sent") || blob.includes("validated")) && !blob.includes("not connected")) {
    wizardTelegramValidated = true;
  }
}

function updateWizardTelegramProgressFromStatus(status) {
  if (!wizardTelegramActive || !status) {
    return;
  }

  const statusText = String(status.status || "").toLowerCase();
  const errorText = String(status.error || "").toLowerCase();

  if (statusText === "done" || statusText === "completed" || statusText === "success") {
    wizardTelegramValidated = true;
  }

  if (statusText === "error" && (errorText.includes("telegram") || errorText.includes("bot"))) {
    wizardTelegramValidated = false;
  }
}

function markTelegramStepSubmitted(template) {
  if (!template || template.intent !== "telegram") {
    return;
  }

  wizardTelegramActive = true;
  if (template.textRole === "bot_token") {
    wizardTelegramTokenSaved = true;
  }
  if (template.textRole === "chat_id") {
    wizardTelegramChatSaved = true;
  }
}

function renderWizardTelegramChecklist(step, template) {
  const show = Boolean(template && template.intent === "telegram");
  wizardElements.telegramPanel.classList.toggle("hidden", !show);

  if (!show) {
    return;
  }

  wizardTelegramActive = true;
  const currentRole = template.textRole || "generic";

  setChecklistItemState(wizardElements.telegramBotfather, wizardTelegramTokenSaved ? "done" : "active");
  setChecklistItemState(
    wizardElements.telegramToken,
    wizardTelegramTokenSaved ? "done" : currentRole === "bot_token" ? "active" : "waiting"
  );
  setChecklistItemState(
    wizardElements.telegramChat,
    wizardTelegramChatSaved ? "done" : (currentRole === "chat_id" || currentRole === "bot_username") ? "active" : (wizardTelegramTokenSaved ? "active" : "waiting")
  );
  setChecklistItemState(
    wizardElements.telegramValidate,
    wizardTelegramValidated ? "done" : (wizardTelegramTokenSaved && wizardTelegramChatSaved ? "active" : "waiting")
  );

  if (wizardTelegramValidated) {
    setWizardTelegramStatus(true, "Status: Telegram bot validated.");
  } else if (wizardTelegramTokenSaved && wizardTelegramChatSaved) {
    setWizardTelegramStatus(false, "Status: credentials saved. Run next step to validate connection.");
  } else if (currentRole === "bot_token") {
    setWizardTelegramStatus(false, "Status: waiting for bot token.");
  } else if (currentRole === "chat_id" || currentRole === "bot_username") {
    setWizardTelegramStatus(false, "Status: waiting for chat/channel destination.");
  } else {
    setWizardTelegramStatus(false, "Status: follow checklist steps to complete Telegram setup.");
  }
}

function setWizardModelStatus(done, message) {
  wizardElements.modelStatus.textContent = message;
  wizardElements.modelStatus.classList.toggle("done", done);
}

function resetWizardModelPanel() {
  wizardModelActive = false;
  wizardModelProvider = "";
  wizardModelName = "";
  wizardModelCredentialSaved = false;
  wizardElements.modelProviderValue.textContent = "Not selected";
  wizardElements.modelNameValue.textContent = "Not selected";
  wizardElements.modelPanel.classList.add("hidden");
  setWizardModelStatus(false, "Status: waiting for provider/model setup steps.");
}

function updateWizardModelSummary() {
  wizardElements.modelProviderValue.textContent = wizardModelProvider || "Not selected";
  wizardElements.modelNameValue.textContent = wizardModelName || "Not selected";
}

function updateWizardModelProgressFromStep(step, template) {
  if (!step || !template || !["provider", "model", "auth"].includes(template.intent)) {
    return;
  }

  wizardModelActive = true;

  if (step.initialValue === undefined || step.initialValue === null || step.initialValue === "") {
    return;
  }

  if (template.intent === "provider") {
    const optionLabel = findOptionLabelForValue(step, step.initialValue);
    const providerText = optionLabel || stringifyWizardValue(step.initialValue);
    const provider = inferProviderLabel(providerText);
    if (provider) {
      wizardModelProvider = provider;
    }
    syncModelStateIntoConfigForm();
    return;
  }

  if (template.intent === "model") {
    const optionLabel = findOptionLabelForValue(step, step.initialValue);
    const modelText = optionLabel || stringifyWizardValue(step.initialValue);
    if (modelText) {
      wizardModelName = modelText;
    }
    if (!wizardModelProvider) {
      const inferred = inferProviderFromModelName(modelText);
      if (inferred) {
        wizardModelProvider = inferred;
      }
    }
    syncModelStateIntoConfigForm();
  }
}

function updateWizardModelProgressFromStatus(status) {
  if (!wizardModelActive || !status) {
    return;
  }

  const statusText = String(status.status || "").toLowerCase();
  if (statusText === "done" || statusText === "completed" || statusText === "success") {
    if (currentWizardTemplate && currentWizardTemplate.intent === "auth") {
      wizardModelCredentialSaved = true;
    }
  }
}

function markModelStepSubmitted(step, template, answer) {
  if (!step || !template || !answer || !["provider", "model", "auth"].includes(template.intent)) {
    return;
  }

  wizardModelActive = true;

  if (template.intent === "provider") {
    const optionLabel = findOptionLabelForValue(step, answer.value);
    const providerText = optionLabel || stringifyWizardValue(answer.value);
    const provider = inferProviderLabel(providerText);
    if (provider) {
      wizardModelProvider = provider;
    }
    syncModelStateIntoConfigForm();
    return;
  }

  if (template.intent === "model") {
    const optionLabel = findOptionLabelForValue(step, answer.value);
    const modelText = optionLabel || stringifyWizardValue(answer.value);
    if (modelText) {
      wizardModelName = modelText;
    }
    if (!wizardModelProvider) {
      const inferred = inferProviderFromModelName(modelText);
      if (inferred) {
        wizardModelProvider = inferred;
      }
    }
    syncModelStateIntoConfigForm();
    return;
  }

  if (template.intent === "auth") {
    const authValue = stringifyWizardValue(answer.value);
    wizardModelCredentialSaved = authValue.length > 0;
  }
}

function renderWizardModelChecklist(step, template) {
  const show = Boolean(template && ["provider", "model", "auth"].includes(template.intent));
  wizardElements.modelPanel.classList.toggle("hidden", !show);

  if (!show) {
    return;
  }

  wizardModelActive = true;
  const currentIntent = template.intent;
  const providerDone = Boolean(wizardModelProvider);
  const modelDone = Boolean(wizardModelName);
  const credentialDone = wizardModelCredentialSaved;

  setChecklistItemState(
    wizardElements.modelProvider,
    providerDone ? "done" : currentIntent === "provider" ? "active" : "waiting"
  );
  setChecklistItemState(
    wizardElements.modelName,
    modelDone ? "done" : currentIntent === "model" ? "active" : providerDone ? "active" : "waiting"
  );
  setChecklistItemState(
    wizardElements.modelCredential,
    credentialDone ? "done" : currentIntent === "auth" ? "active" : providerDone && modelDone ? "active" : "waiting"
  );

  updateWizardModelSummary();

  if (credentialDone) {
    setWizardModelStatus(true, "Status: provider, model, and credentials are configured.");
  } else if (currentIntent === "provider") {
    setWizardModelStatus(false, "Status: choose which AI provider to use.");
  } else if (currentIntent === "model") {
    setWizardModelStatus(false, "Status: choose the default model for this provider.");
  } else if (currentIntent === "auth") {
    setWizardModelStatus(false, "Status: save API credential to activate model access.");
  } else {
    setWizardModelStatus(false, "Status: complete provider, model, and credential steps.");
  }
}

function resetWizardQrPanel() {
  currentWizardQrRequired = false;
  wizardQrScanned = false;
  wizardQrStepId = "";
  wizardQrCodeVisible = false;
  wizardPairingConnected = false;

  wizardElements.qrPanel.classList.add("hidden");
  wizardElements.qrChecklist.classList.add("hidden");
  wizardElements.qrImage.classList.add("hidden");
  wizardElements.qrAscii.classList.add("hidden");
  wizardElements.qrFallback.classList.remove("hidden");
  wizardElements.qrFallback.textContent =
    "QR code is not available in this step payload yet. Follow the wizard instructions and refresh if needed.";
  wizardElements.qrImage.removeAttribute("src");
  wizardElements.qrAscii.textContent = "";
  wizardElements.qrAscii.classList.remove("payload");
  setWizardQrScanStatus(false, "Status: waiting for scan confirmation.");
  renderWizardPairingChecklist();
}

function findWizardQrCandidate(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return "";
    }

    if (text.startsWith("data:image/")) {
      return text;
    }

    if (/^https?:\/\/\S+/i.test(text) && (text.toLowerCase().includes("qr") || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(text))) {
      return text;
    }

    if (text.includes("\n") && /[█▓▒░#]/.test(text)) {
      return text;
    }

    if (text.length > 120 && !text.startsWith("{") && !text.startsWith("[")) {
      return text;
    }

    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findWizardQrCandidate(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    const record = value;
    const priorityKeys = [
      "qr",
      "qrCode",
      "qr_code",
      "qrData",
      "qr_data",
      "qrImage",
      "qr_image",
      "qrUrl",
      "qr_url",
      "dataUrl",
      "data_url",
      "pairingCode",
      "pairing_code",
      "code",
      "payload",
      "value"
    ];

    for (const key of priorityKeys) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        const candidate = findWizardQrCandidate(record[key], depth + 1);
        if (candidate) {
          return candidate;
        }
      }
    }

    for (const item of Object.values(record)) {
      const candidate = findWizardQrCandidate(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
  }

  return "";
}

function classifyWizardQrCandidate(candidate) {
  if (!candidate) {
    return { kind: "none", value: "" };
  }

  if (candidate.startsWith("data:image/")) {
    return { kind: "image", value: candidate };
  }

  if (/^https?:\/\/\S+/i.test(candidate) && (candidate.toLowerCase().includes("qr") || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(candidate))) {
    return { kind: "image", value: candidate };
  }

  if (candidate.includes("\n") && /[█▓▒░#]/.test(candidate)) {
    return { kind: "ascii", value: candidate };
  }

  return { kind: "payload", value: candidate };
}

function isWhatsAppQrStep(step, template, qrCandidate) {
  if (!step || !template || template.intent !== "whatsapp") {
    return false;
  }

  if (qrCandidate.kind !== "none") {
    return true;
  }

  const blob = getWizardStepBlob(step);
  return blob.includes("qr") && (blob.includes("scan") || blob.includes("pair"));
}

function renderWizardQrPanel(step, template) {
  const qrCandidate = classifyWizardQrCandidate(findWizardQrCandidate(step));
  const showQrPanel = isWhatsAppQrStep(step, template, qrCandidate);

  if (!showQrPanel) {
    resetWizardQrPanel();
    return;
  }

  const stepId = step.id || "";
  const isSameStep = wizardQrStepId === stepId;
  wizardQrStepId = stepId;
  currentWizardQrRequired = true;
  if (!isSameStep) {
    wizardQrScanned = false;
    wizardPairingConnected = false;
  }
  wizardQrCodeVisible = qrCandidate.kind !== "none";

  wizardElements.qrPanel.classList.remove("hidden");
  wizardElements.qrImage.classList.add("hidden");
  wizardElements.qrAscii.classList.add("hidden");
  wizardElements.qrFallback.classList.add("hidden");
  wizardElements.qrAscii.classList.remove("payload");
  wizardElements.qrAscii.textContent = "";
  wizardElements.qrImage.removeAttribute("src");

  if (qrCandidate.kind === "image") {
    wizardElements.qrImage.setAttribute("src", qrCandidate.value);
    wizardElements.qrImage.classList.remove("hidden");
  } else if (qrCandidate.kind === "ascii") {
    wizardElements.qrAscii.textContent = qrCandidate.value;
    wizardElements.qrAscii.classList.remove("hidden");
  } else if (qrCandidate.kind === "payload") {
    wizardElements.qrAscii.textContent = qrCandidate.value;
    wizardElements.qrAscii.classList.add("payload");
    wizardElements.qrAscii.classList.remove("hidden");
    wizardElements.qrFallback.classList.remove("hidden");
    wizardElements.qrFallback.textContent =
      "Raw pairing payload shown. If QR image is expected, click Refresh Status or open Control workspace.";
  } else {
    wizardElements.qrFallback.classList.remove("hidden");
    wizardElements.qrFallback.textContent =
      "QR placeholder step detected. Follow WhatsApp instructions and refresh until the QR appears.";
  }

  if (wizardQrScanned) {
    if (wizardPairingConnected) {
      setWizardQrScanStatus(true, "Status: connected.");
    } else {
      setWizardQrScanStatus(true, "Status: scan confirmed.");
    }
  } else {
    setWizardQrScanStatus(false, "Status: waiting for scan confirmation.");
  }

  renderWizardPairingChecklist();
}

function confirmWizardQrScanned() {
  wizardQrScanned = true;
  setWizardQrScanStatus(true, wizardPairingConnected ? "Status: connected." : "Status: scan confirmed.");
  clearWizardValidation();

  if (currentWizardStep && currentWizardStep.type === "confirm") {
    const confirmInput = wizardElements.inputContainer.querySelector("#wizardConfirmInput");
    if (confirmInput) {
      confirmInput.checked = true;
    }
  }

  appendLog("WhatsApp QR marked as scanned.");
  renderWizardPairingChecklist();
  updateWizardActionAvailability();
}

function getWizardStepBlob(step) {
  if (!step) {
    return "";
  }

  const parts = [step.id, step.title, step.message];
  for (const option of step.options || []) {
    parts.push(option.label);
    parts.push(option.hint);
  }

  const blob = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return blob;
}

function getWizardIntent(step) {
  const blob = getWizardStepBlob(step);
  if (!blob) {
    return "generic";
  }

  const whatsappKeywords = [
    "whatsapp",
    "wa",
    "qr",
    "pair",
    "pairing",
    "scan code",
    "link device",
    "phone number"
  ];
  const telegramKeywords = [
    "telegram",
    "botfather",
    "/newbot",
    "bot token",
    "chat id",
    "channel id",
    "bot username",
    "t.me"
  ];
  const modelKeywords = [
    "choose model",
    "select model",
    "default model",
    "model id",
    "model name",
    "gpt-",
    "claude",
    "sonnet",
    "haiku",
    "gemini-",
    "llama",
    "mistral",
    "deepseek"
  ];

  const providerKeywords = [
    "provider",
    "model provider",
    "llm provider",
    "openai",
    "anthropic",
    "gemini",
    "groq",
    "ollama",
    "azure",
    "bedrock"
  ];
  const authKeywords = ["token", "api key", "apikey", "secret", "credential", "auth", "access key", "client secret"];
  const workspaceKeywords = ["workspace", "folder", "directory", "path", "project", "repository", "repo"];

  if (whatsappKeywords.some((keyword) => blob.includes(keyword))) {
    return "whatsapp";
  }

  if (telegramKeywords.some((keyword) => blob.includes(keyword))) {
    return "telegram";
  }

  if ((blob.includes("provider") || blob.includes("model provider")) && !blob.includes("default model") && !blob.includes("model id")) {
    return "provider";
  }

  if (modelKeywords.some((keyword) => blob.includes(keyword))) {
    return "model";
  }

  if (providerKeywords.some((keyword) => blob.includes(keyword))) {
    return "provider";
  }

  if (authKeywords.some((keyword) => blob.includes(keyword))) {
    return "auth";
  }

  if (workspaceKeywords.some((keyword) => blob.includes(keyword))) {
    return "workspace";
  }

  return "generic";
}

function getWizardTextRole(step, intent) {
  const blob = getWizardStepBlob(step);

  if (!blob) {
    return "generic";
  }

  if (intent === "whatsapp") {
    if (blob.includes("phone")) {
      return "phone_number";
    }
    if (blob.includes("pair") || blob.includes("code")) {
      return "pairing_code";
    }
    return "generic";
  }

  if (intent === "telegram") {
    if (blob.includes("token")) {
      return "bot_token";
    }
    if (blob.includes("chat id") || blob.includes("channel id")) {
      return "chat_id";
    }
    if (blob.includes("username")) {
      return "bot_username";
    }
    return "generic";
  }

  if (intent === "auth") {
    return "auth_token";
  }

  if (intent === "model") {
    if (blob.includes("id")) {
      return "model_id";
    }
    if (blob.includes("name")) {
      return "model_name";
    }
    return "model_id";
  }

  if (intent === "workspace") {
    return "workspace_path";
  }

  return "generic";
}

function getWizardOptionHint(intent, option) {
  if (option.hint) {
    return option.hint;
  }

  const label = (option.label || "").toLowerCase();
  if (intent === "provider") {
    if (label.includes("ollama") || label.includes("local")) {
      return "Runs locally on your machine.";
    }
    if (label.includes("openai") || label.includes("anthropic") || label.includes("gemini") || label.includes("groq")) {
      return "Requires an API key.";
    }
  }

  if (intent === "whatsapp") {
    if (label.includes("qr")) {
      return "Scan QR code using WhatsApp on your phone.";
    }
    if (label.includes("pair") || label.includes("code")) {
      return "Use phone-number pairing code flow.";
    }
    if (label.includes("restart") || label.includes("reconnect")) {
      return "Use this if session was disconnected.";
    }
  }

  if (intent === "telegram") {
    if (label.includes("botfather")) {
      return "Create/manage bot in Telegram via @BotFather.";
    }
    if (label.includes("polling")) {
      return "Simpler setup, no webhook URL needed.";
    }
    if (label.includes("webhook")) {
      return "Requires public HTTPS endpoint.";
    }
  }

  if (intent === "model") {
    if (label.includes("gpt") || label.includes("o1") || label.includes("o3")) {
      return "High quality OpenAI model.";
    }
    if (label.includes("claude") || label.includes("sonnet") || label.includes("haiku")) {
      return "Anthropic Claude family model.";
    }
    if (label.includes("gemini")) {
      return "Google Gemini model.";
    }
    if (label.includes("llama") || label.includes("mistral") || label.includes("deepseek")) {
      return "Common self-hosted or open model family.";
    }
  }

  return "";
}

function buildWizardTemplate(step) {
  const intent = getWizardIntent(step);
  const textRole = getWizardTextRole(step, intent);
  const template = {
    intent,
    textRole,
    title: "",
    message: "",
    guideHint: "",
    textPlaceholder: "",
    selectPlaceholder: "",
    submitLabel: ""
  };

  if (intent === "provider") {
    template.title = "Choose Provider";
    template.message = "Pick your AI provider.";
    template.guideHint = "Use the provider you already have access to.";
    template.selectPlaceholder = "Choose a provider";
    template.submitLabel = "Use Provider";
  } else if (intent === "model") {
    template.title = "Choose Model";
    template.message = "Pick a default model.";
    template.guideHint = "You can change this later.";
    template.selectPlaceholder = "Choose a model";
    template.textPlaceholder = "gpt-4o-mini";
    template.submitLabel = "Use Model";
  } else if (intent === "auth") {
    template.title = "Add Credential";
    template.message = "Paste your API key/token.";
    template.guideHint = "Keep this private.";
    template.textPlaceholder = "Paste API key or token";
    template.submitLabel = "Save Credential";
  } else if (intent === "workspace") {
    template.title = "Choose Folder";
    template.message = "Choose where OpenClaw stores data.";
    template.guideHint = "Use an easy-to-find folder.";
    template.textPlaceholder = "C:\\Users\\You\\OpenClaw";
    template.submitLabel = "Use Workspace";
  } else if (intent === "whatsapp") {
    template.title = "Connect WhatsApp";
    template.message = "Pair your WhatsApp account.";
    template.guideHint = "Keep your phone online while pairing.";
    template.selectPlaceholder = "Choose WhatsApp setup option";
    template.submitLabel = "Continue";

    if (textRole === "phone_number") {
      template.textPlaceholder = "+15551234567";
      template.submitLabel = "Use Phone Number";
      template.guideHint = "Include country code.";
    } else if (textRole === "pairing_code") {
      template.textPlaceholder = "Enter pairing code";
      template.submitLabel = "Submit Pairing Code";
      template.guideHint = "Copy it exactly.";
    }
  } else if (intent === "telegram") {
    template.title = "Connect Telegram";
    template.message = "Set up your Telegram bot.";
    template.guideHint = "Create bot in @BotFather, then paste values here.";
    template.selectPlaceholder = "Choose Telegram setup option";
    template.submitLabel = "Continue";

    if (textRole === "bot_token") {
      template.textPlaceholder = "123456789:AAExampleBotToken";
      template.submitLabel = "Save Bot Token";
      template.guideHint = "Token usually has a colon.";
    } else if (textRole === "chat_id") {
      template.textPlaceholder = "-1001234567890";
      template.submitLabel = "Save Chat ID";
      template.guideHint = "Use the destination chat/channel ID.";
    } else if (textRole === "bot_username") {
      template.textPlaceholder = "@your_bot_username";
      template.submitLabel = "Save Bot Username";
      template.guideHint = "With or without @.";
    }
  }

  return template;
}

function clearWizardValidation() {
  wizardElements.validation.classList.add("hidden");
  wizardElements.validation.textContent = "";
}

function setWizardValidation(message) {
  if (!message) {
    clearWizardValidation();
    return;
  }

  wizardElements.validation.textContent = message;
  wizardElements.validation.classList.remove("hidden");
}

function stopWizardStatusPolling() {
  if (wizardStatusPollTimer) {
    window.clearInterval(wizardStatusPollTimer);
    wizardStatusPollTimer = null;
  }
}

function startWizardStatusPolling() {
  stopWizardStatusPolling();
  if (!wizardSessionId) {
    return;
  }

  wizardStatusPollTimer = window.setInterval(async () => {
    await refreshWizardStatus(true);
  }, 4000);
}

function updateWizardActionAvailability() {
  const hasSession = Boolean(wizardSessionId);
  const hasStep = Boolean(currentWizardStep);
  const qrGateBlocked = currentWizardQrRequired && !wizardQrScanned;

  wizardElements.start.disabled = hasSession;
  wizardElements.submit.disabled = !hasSession || !hasStep || qrGateBlocked;
  wizardElements.cancel.disabled = !hasSession;
  wizardElements.refresh.disabled = !hasSession;
  wizardElements.complete.disabled = hasSession;
  wizardElements.qrScanned.disabled = !hasSession || !currentWizardQrRequired || wizardQrScanned;
}

function isStepRequired(step) {
  if (!step) {
    return false;
  }

  if (typeof step.required === "boolean") {
    return step.required;
  }

  return ["text", "select", "confirm", "multiselect", "action"].includes(step.type);
}

function setWizardSubmitLabel(stepType, template) {
  if (template && template.submitLabel) {
    wizardElements.submit.textContent = template.submitLabel;
    return;
  }

  if (stepType === "action") {
    wizardElements.submit.textContent = "Apply";
    return;
  }

  if (stepType === "progress") {
    wizardElements.submit.textContent = "Continue";
    return;
  }

  if (stepType === "text" || stepType === "select" || stepType === "multiselect" || stepType === "confirm") {
    wizardElements.submit.textContent = "Submit";
    return;
  }

  wizardElements.submit.textContent = "Continue";
}

function resetWizardUi() {
  stopWizardStatusPolling();
  wizardSessionId = "";
  currentWizardStep = null;
  currentWizardTemplate = null;
  lastWizardStatusValue = "";
  wizardElements.stepCard.classList.add("hidden");
  wizardElements.stepMeta.textContent = "Type: note";
  wizardElements.inputContainer.innerHTML = "";
  clearWizardValidation();
  setWizardGuideHint("");
  resetWizardQrPanel();
  resetWizardTelegramPanel();
  resetWizardModelPanel();
  setWizardSessionLabel("No session.");
  setWizardRawState({ note: "Wizard state will appear here." });
  updateWizardActionAvailability();
}

function renderWizardInput(step, template) {
  wizardElements.inputContainer.innerHTML = "";
  clearWizardValidation();
  stopWizardStatusPolling();

  if (!step) {
    return;
  }

  if (step.type === "text") {
    const input = document.createElement("input");
    input.type = step.sensitive ? "password" : "text";
    input.placeholder = step.placeholder || template.textPlaceholder || "Enter value and submit";
    input.value = typeof step.initialValue === "string" ? step.initialValue : "";
    input.id = "wizardTextInput";
    input.autocomplete = "off";
    if (isStepRequired(step)) {
      input.required = true;
    }
    wizardElements.inputContainer.appendChild(input);
    return;
  }

  if (step.type === "confirm") {
    const wrapper = document.createElement("label");
    wrapper.className = "wizard-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "wizardConfirmInput";
    checkbox.checked = Boolean(step.initialValue);
    wrapper.appendChild(checkbox);

    const text = document.createElement("span");
    text.textContent = step.message || "Confirm and continue";
    wrapper.appendChild(text);
    wizardElements.inputContainer.appendChild(wrapper);
    return;
  }

  if (step.type === "select") {
    const select = document.createElement("select");
    select.id = "wizardSelectInput";
    const required = isStepRequired(step);
    if (required) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = template.selectPlaceholder || "Select an option";
      placeholder.disabled = true;
      placeholder.selected = step.initialValue === undefined;
      select.appendChild(placeholder);
    }
    (step.options || []).forEach((option, index) => {
      const item = document.createElement("option");
      item.value = String(index);
      const hint = getWizardOptionHint(template.intent, option);
      item.textContent = hint ? `${option.label} - ${hint}` : option.label;
      if (step.initialValue !== undefined && JSON.stringify(option.value) === JSON.stringify(step.initialValue)) {
        item.selected = true;
      }
      select.appendChild(item);
    });
    wizardElements.inputContainer.appendChild(select);
    return;
  }

  if (step.type === "multiselect") {
    (step.options || []).forEach((option, index) => {
      const wrapper = document.createElement("label");
      wrapper.className = "wizard-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.optionIndex = String(index);
      checkbox.className = "wizardMultiCheckbox";

      if (Array.isArray(step.initialValue)) {
        checkbox.checked = step.initialValue.some((value) => JSON.stringify(value) === JSON.stringify(option.value));
      }

      const text = document.createElement("span");
      text.textContent = option.label;
      wrapper.appendChild(checkbox);
      wrapper.appendChild(text);

      const hintText = getWizardOptionHint(template.intent, option);
      if (hintText) {
        const hint = document.createElement("small");
        hint.textContent = ` ${hintText}`;
        wrapper.appendChild(hint);
      }

      wizardElements.inputContainer.appendChild(wrapper);
    });
    const note = document.createElement("p");
    note.className = "wizard-inline-note";
    note.textContent = isStepRequired(step)
      ? "Pick at least one option."
      : "Pick one or more options, or continue without selecting.";
    wizardElements.inputContainer.appendChild(note);
    return;
  }

  if (step.type === "action") {
    (step.options || []).forEach((option, index) => {
      const wrapper = document.createElement("label");
      wrapper.className = "wizard-option wizard-option-action";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "wizardActionChoice";
      radio.value = String(index);
      radio.className = "wizardActionRadio";
      if (step.initialValue !== undefined && JSON.stringify(option.value) === JSON.stringify(step.initialValue)) {
        radio.checked = true;
        wrapper.classList.add("selected");
      }

      radio.addEventListener("change", () => {
        const nodes = wizardElements.inputContainer.querySelectorAll(".wizard-option-action");
        nodes.forEach((node) => node.classList.remove("selected"));
        wrapper.classList.add("selected");
      });

      const text = document.createElement("span");
      text.textContent = option.label;
      wrapper.appendChild(radio);
      wrapper.appendChild(text);

      const hintText = getWizardOptionHint(template.intent, option);
      if (hintText) {
        const hint = document.createElement("small");
        hint.textContent = ` ${hintText}`;
        wrapper.appendChild(hint);
      }

      wizardElements.inputContainer.appendChild(wrapper);
    });
    return;
  }

  if (step.type === "progress") {
    const note = document.createElement("p");
    note.className = "wizard-inline-note";
    if (template.intent === "whatsapp") {
      note.textContent = "Waiting for WhatsApp pairing status. Keep your phone connected; this screen refreshes automatically.";
    } else if (template.intent === "telegram") {
      note.textContent = "Checking Telegram bot connection. This status refreshes automatically every few seconds.";
    } else if (template.intent === "model" || template.intent === "provider" || template.intent === "auth") {
      note.textContent = "Applying model configuration. This status refreshes automatically every few seconds.";
    } else {
      note.textContent = "Working in background. Auto-refreshing.";
    }
    wizardElements.inputContainer.appendChild(note);
    startWizardStatusPolling();
    return;
  }

  if (step.type === "note") {
    const note = document.createElement("p");
    note.className = "wizard-inline-note";
    if (template.intent === "whatsapp") {
      note.textContent = "Follow the step above, then continue.";
    } else if (template.intent === "telegram") {
      note.textContent = "Follow the step above, then continue.";
    } else if (template.intent === "model" || template.intent === "provider" || template.intent === "auth") {
      note.textContent = "Follow the step above, then continue.";
    } else {
      note.textContent = "Continue when ready.";
    }
    wizardElements.inputContainer.appendChild(note);
    return;
  }

  const note = document.createElement("p");
  note.className = "wizard-inline-note";
  note.textContent = "Unknown step type received. Continue if the instruction above is complete.";
  wizardElements.inputContainer.appendChild(note);
}

function renderWizardStep(step) {
  currentWizardStep = step || null;
  if (!step) {
    currentWizardTemplate = null;
    stopWizardStatusPolling();
    resetWizardQrPanel();
    resetWizardTelegramPanel();
    resetWizardModelPanel();
    wizardElements.stepCard.classList.add("hidden");
    setWizardGuideHint("");
    updateWizardActionAvailability();
    return;
  }

  const template = buildWizardTemplate(step);
  currentWizardTemplate = template;
  const rawStepMessage = step.message || "";
  const resolvedMessage = template.message || rawStepMessage || "Follow this step and continue.";
  const guideParts = [];
  if (template.guideHint) {
    guideParts.push(template.guideHint);
  }
  if (template.message && rawStepMessage && rawStepMessage !== template.message) {
    guideParts.push(`OpenClaw detail: ${rawStepMessage}`);
  }

  wizardElements.stepCard.classList.remove("hidden");
  wizardElements.stepTitle.textContent = template.title || step.title || step.id || "Onboarding Step";
  wizardElements.stepMessage.textContent = resolvedMessage;
  wizardElements.stepMeta.textContent = `Type: ${step.type} | ID: ${step.id || "n/a"}${step.executor ? ` | Executor: ${step.executor}` : ""}${template.intent !== "generic" ? ` | Intent: ${template.intent}` : ""}${template.textRole && template.textRole !== "generic" ? ` | Field: ${template.textRole}` : ""}`;
  setWizardGuideHint(guideParts.join(" "));
  setWizardSubmitLabel(step.type, template);
  updateWizardTelegramProgressFromStep(step, template);
  updateWizardModelProgressFromStep(step, template);
  renderWizardQrPanel(step, template);
  renderWizardTelegramChecklist(step, template);
  renderWizardModelChecklist(step, template);
  renderWizardInput(step, template);
  updateWizardActionAvailability();
}

function getWizardAnswer(step) {
  if (!step) {
    return null;
  }

  if (step.type === "text") {
    const input = byId("wizardTextInput");
    return { stepId: step.id, value: input.value.trim() };
  }

  if (step.type === "confirm") {
    const checkbox = byId("wizardConfirmInput");
    return { stepId: step.id, value: checkbox.checked };
  }

  if (step.type === "select") {
    const select = byId("wizardSelectInput");
    if (select.value === "") {
      return { stepId: step.id, value: null };
    }
    const index = Number.parseInt(select.value, 10);
    const option = (step.options || [])[index];
    return { stepId: step.id, value: option ? option.value : null };
  }

  if (step.type === "multiselect") {
    const nodes = [...wizardElements.inputContainer.querySelectorAll(".wizardMultiCheckbox")];
    const values = nodes
      .filter((node) => node.checked)
      .map((node) => {
        const index = Number.parseInt(node.dataset.optionIndex || "-1", 10);
        const option = (step.options || [])[index];
        return option ? option.value : null;
      })
      .filter((value) => value !== null);

    return { stepId: step.id, value: values };
  }

  if (step.type === "action") {
    const selected = wizardElements.inputContainer.querySelector(".wizardActionRadio:checked");
    if (!selected) {
      return { stepId: step.id, value: null };
    }
    const index = Number.parseInt(selected.value, 10);
    const option = (step.options || [])[index];
    return { stepId: step.id, value: option ? option.value : null };
  }

  return { stepId: step.id };
}

function validateWizardAnswer(step, answer, template) {
  if (!step) {
    return "No step is currently active.";
  }

  if (currentWizardQrRequired && !wizardQrScanned) {
    return "Scan the WhatsApp QR code first, then click 'I Have Scanned the QR'.";
  }

  const required = isStepRequired(step);
  if (!required) {
    return null;
  }

  if (step.type === "text") {
    if (typeof answer.value !== "string" || answer.value.length === 0) {
      return "This field is required. Enter a value to continue.";
    }

    if (template && template.intent === "auth" && answer.value.length < 8) {
      return "This credential looks too short. Double-check and paste the full key/token.";
    }

    if (template && template.intent === "model") {
      if (answer.value.length < 2) {
        return "Model value looks too short. Enter a valid model name, for example gpt-4o-mini.";
      }

      if (!/^[A-Za-z0-9._:/-]+$/.test(answer.value)) {
        return "Model value contains unsupported characters. Use letters, numbers, dot, dash, underscore, colon, or slash.";
      }
    }

    if (template && template.intent === "workspace") {
      if (answer.value.length < 3) {
        return "Workspace path is too short. Enter a full folder path.";
      }

      if (/[*?\"<>|]/.test(answer.value)) {
        return "Workspace path contains invalid characters. Remove * ? \" < > | and retry.";
      }
    }

    if (template && template.intent === "whatsapp") {
      if (template.textRole === "phone_number") {
        const normalized = answer.value.replace(/\s+/g, "");
        if (!/^\+?[0-9]{8,16}$/.test(normalized)) {
          return "Enter a valid WhatsApp phone number with country code, e.g. +15551234567.";
        }
      }

      if (template.textRole === "pairing_code") {
        if (answer.value.length < 4) {
          return "Pairing code looks too short. Enter the full code from your phone.";
        }
      }
    }

    if (template && template.intent === "telegram") {
      if (template.textRole === "bot_token") {
        if (!/^[0-9]{5,}:[A-Za-z0-9_-]{15,}$/.test(answer.value)) {
          return "Telegram bot token format looks invalid. It should look like 123456789:AA...";
        }
      }

      if (template.textRole === "chat_id") {
        if (!/^-?[0-9]{5,}$/.test(answer.value)) {
          return "Chat ID should be numeric (often negative for channels/groups).";
        }
      }

      if (template.textRole === "bot_username") {
        const normalizedUsername = answer.value.startsWith("@") ? answer.value.slice(1) : answer.value;
        if (!/^[A-Za-z0-9_]{5,32}$/.test(normalizedUsername)) {
          return "Bot username should be 5-32 characters using letters, numbers, or underscore.";
        }
      }
    }

    return null;
  }

  if (step.type === "confirm") {
    if (answer.value !== true) {
      return "Please confirm this step to continue.";
    }
    return null;
  }

  if (step.type === "select") {
    if (answer.value === null || answer.value === undefined || answer.value === "") {
      return "Please choose one option.";
    }
    return null;
  }

  if (step.type === "multiselect") {
    if (!Array.isArray(answer.value) || answer.value.length === 0) {
      return "Please choose at least one option.";
    }
    return null;
  }

  if (step.type === "action") {
    if (answer.value === null || answer.value === undefined || answer.value === "") {
      return "Choose an action before continuing.";
    }
    return null;
  }

  return null;
}

async function handleWizardCompletion() {
  stopWizardStatusPolling();
  wizardPairingConnected = true;
  renderWizardPairingChecklist();
  appendLog("Wizard reported completion. Finalizing onboarding setup state...");
  const state = await window.openclaw.completeOnboardingFromUi();
  renderSetupState(state);
  appendLog(`Setup: ${state.message}`);
  await runEnvironmentCheck();
  await refreshSetupState();
  updateWizardActionAvailability();
}

function renderWizardResult(payload) {
  if (payload.sessionId) {
    wizardSessionId = payload.sessionId;
  }

  if (wizardSessionId) {
    setWizardSessionLabel(`Session: ${wizardSessionId}`);
  } else {
    setWizardSessionLabel("No session.");
  }

  setWizardRawState(payload);

  if (payload.error) {
    appendLog(`Wizard error: ${payload.error}`);
    setWizardValidation(payload.error);
  }

  if (payload.step) {
    updateWizardPairingConnectedFromStep(payload.step);
    renderWizardStep(payload.step);
  }

  if (payload.done) {
    if (currentWizardTemplate && currentWizardTemplate.intent === "telegram") {
      wizardTelegramValidated = true;
    }
    if (wizardModelActive) {
      wizardModelCredentialSaved = wizardModelCredentialSaved || (currentWizardTemplate && currentWizardTemplate.intent === "auth");
      syncModelStateIntoConfigForm();
    }
    wizardPairingConnected = true;
    stopWizardStatusPolling();
    clearWizardValidation();
    renderWizardStep(null);
    wizardSessionId = "";
    setWizardSessionLabel("Wizard completed.");
  }

  renderWizardPairingChecklist();
  updateWizardActionAvailability();
}

async function startWizard() {
  if (wizardSessionId) {
    appendLog("A wizard session is already active. Complete or cancel it before starting a new one.");
    return;
  }

  appendLog("Starting onboarding wizard...");
  clearWizardValidation();

  if (!lastEnvironmentStatus || !lastEnvironmentStatus.gatewayRunning) {
    const startResult = await window.openclaw.gatewayStart();
    summarizeCommandResult("Gateway start", startResult);
    await runEnvironmentCheck();
  }

  const workspacePath = byId("workspacePath").value.trim();
  const params = workspacePath ? { mode: "local", workspace: workspacePath } : { mode: "local" };
  const start = await window.openclaw.wizardStart(params);
  renderWizardResult(start);

  if (start.done) {
    await handleWizardCompletion();
  }
}

async function submitWizardStep() {
  if (!wizardSessionId) {
    appendLog("No session. Start first.");
    setWizardValidation("Start the wizard before submitting a step.");
    return;
  }

  const answer = getWizardAnswer(currentWizardStep);
  const validationError = validateWizardAnswer(currentWizardStep, answer || {}, currentWizardTemplate);
  if (validationError) {
    setWizardValidation(validationError);
    appendLog(`Wizard validation: ${validationError}`);
    return;
  }

  clearWizardValidation();
  const result = await window.openclaw.wizardNext(wizardSessionId, answer || undefined);
  if (!result.error) {
    markTelegramStepSubmitted(currentWizardTemplate);
    markModelStepSubmitted(currentWizardStep, currentWizardTemplate, answer || {});
  }
  renderWizardResult(result);

  if (result.done) {
    await handleWizardCompletion();
  }
}

async function refreshWizardStatus(silent = false) {
  if (!wizardSessionId) {
    if (!silent) {
      appendLog("No session to refresh.");
      setWizardValidation("No session.");
    }
    return;
  }

  const status = await window.openclaw.wizardStatus(wizardSessionId);
  setWizardRawState(status);
  if (!silent || lastWizardStatusValue !== status.status) {
    appendLog(`Wizard status: ${status.status}`);
  }
  lastWizardStatusValue = status.status;
  updateWizardPairingConnectedFromStatus(status);
  updateWizardTelegramProgressFromStatus(status);
  updateWizardModelProgressFromStatus(status);

  if (wizardPairingConnected && currentWizardQrRequired) {
    setWizardQrScanStatus(true, "Status: connected.");
  }
  renderWizardPairingChecklist();
  renderWizardTelegramChecklist(currentWizardStep, currentWizardTemplate);
  renderWizardModelChecklist(currentWizardStep, currentWizardTemplate);

  if (status.status === "error" && status.error) {
    setWizardValidation(status.error);
  }
}

async function cancelWizard() {
  if (!wizardSessionId) {
    appendLog("No session to cancel.");
    return;
  }

  const sessionToCancel = wizardSessionId;
  const status = await window.openclaw.wizardCancel(sessionToCancel);
  appendLog(`Wizard cancelled: ${status.status}`);
  resetWizardUi();
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

async function openControlWorkspace() {
  setWorkspace("control");
  await runEnvironmentCheck();
  await refreshSetupState();
  updateControlSurface();
}

async function reconnectChannel(channel) {
  try {
    const status = await window.openclaw.reconnectChannel(channel);
    appendLog(`${channel} reconnect requested.`);
    await refreshChannelStatuses();
    return status;
  } catch (error) {
    appendLog(`${channel} reconnect command failed: ${formatError(error)}`);
    if (!wizardSessionId) {
      appendLog("Opening onboarding wizard for guided reconnect.");
      await startWizard();
    }
    return null;
  }
}

async function disableChannel(channel) {
  const status = await window.openclaw.disableChannel(channel);
  appendLog(`${channel} disabled.`);
  await refreshChannelStatuses();
  return status;
}

async function applyManagedModelSelection() {
  const provider = modelManagementElements.provider.value.trim();
  const model = modelManagementElements.model.value.trim();

  if (!provider || !model) {
    appendLog("Model apply failed: provider/model required.");
    return;
  }

  const status = await window.openclaw.applyModelSelection(provider, model);
  renderModelManagementStatus(status);
  byId("modelProvider").value = provider;
  byId("modelName").value = model;
  appendLog(`Model applied: ${provider} / ${model}`);
}

async function checkForUpdatesNow() {
  const status = await window.openclaw.checkForUpdates();
  renderUpdateStatus(status);
  appendLog(`Update: ${status.message}`);
}

async function installUpdateNow() {
  if (!lastUpdateStatus || lastUpdateStatus.state !== "downloaded") {
    appendLog("No downloaded update ready.");
    return;
  }

  appendLog("Installing update and restarting app...");
  await window.openclaw.installDownloadedUpdate();
}

async function saveTelegramHelperToken() {
  const token = telegramHelperElements.token.value.trim();
  const validation = validateTelegramHelperToken(token);
  if (validation) {
    setTelegramHelperValidation(validation);
    appendLog(`Telegram helper: ${validation}`);
    return;
  }

  setTelegramHelperValidation("");
  await window.openclaw.configureTelegramBot(token);
  appendLog("Telegram token saved.");
  await refreshChannelStatuses();
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
      appendLog("Starting guided setup. This installs WSL, OpenClaw, and preps gateway for onboarding wizard.");
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
      await refreshSetupState();
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
      appendLog("Running CLI onboarding fallback...");
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

  channelElements.refresh.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await refreshChannelStatuses(true);
    });
  });

  channelElements.whatsappReconnect.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await reconnectChannel("whatsapp");
    });
  });

  channelElements.whatsappDisable.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await disableChannel("whatsapp");
    });
  });

  channelElements.telegramReconnect.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await reconnectChannel("telegram");
    });
  });

  channelElements.telegramDisable.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await disableChannel("telegram");
    });
  });

  modelManagementElements.refresh.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await refreshModelManagementStatus(true);
    });
  });

  modelManagementElements.apply.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, applyManagedModelSelection);
  });

  updateElements.check.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, checkForUpdatesNow);
  });

  updateElements.install.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, installUpdateNow);
  });

  telegramHelperElements.startReconnect.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await reconnectChannel("telegram");
    });
  });

  telegramHelperElements.copyBotFather.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await copyToClipboard("https://t.me/BotFather", "Copied @BotFather link.");
    });
  });

  telegramHelperElements.copyNewBot.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      await copyToClipboard("/newbot", "Copied /newbot.");
    });
  });

  telegramHelperElements.saveToken.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, saveTelegramHelperToken);
  });

  telegramHelperElements.token.addEventListener("input", () => {
    const token = telegramHelperElements.token.value.trim();
    const validation = token ? validateTelegramHelperToken(token) : "";
    setTelegramHelperValidation(validation);
  });

  alwaysOnElements.toggle.addEventListener("change", async () => {
    const requested = alwaysOnElements.toggle.checked;
    const previous = Boolean(lastAlwaysOnGatewayStatus && lastAlwaysOnGatewayStatus.enabled);
    alwaysOnElements.toggle.disabled = true;

    try {
      appendLog(
        requested
          ? "Enabling always-on gateway via Windows Task Scheduler..."
          : "Disabling always-on gateway..."
      );
      const status = await window.openclaw.setAlwaysOnGatewayEnabled(requested);
      renderAlwaysOnGatewayStatus(status);
      appendLog(status.detail);
    } catch (error) {
      alwaysOnElements.toggle.checked = previous;
      appendLog(`Always-on toggle failed: ${formatError(error)}`);
      await refreshAlwaysOnGatewayStatus();
    } finally {
      if (lastAlwaysOnGatewayStatus && lastAlwaysOnGatewayStatus.supported) {
        alwaysOnElements.toggle.disabled = false;
      }
    }
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

  wizardElements.start.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, startWizard);
  });

  wizardElements.submit.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, submitWizardStep);
  });

  wizardElements.refresh.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, refreshWizardStatus);
  });

  wizardElements.cancel.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, cancelWizard);
  });

  wizardElements.qrScanned.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, async () => {
      confirmWizardQrScanned();
    });
  });

  wizardElements.complete.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    await withBusy(button, handleWizardCompletion);
  });
}

async function bootstrap() {
  try {
    removeSetupProgressListener = window.openclaw.onSetupProgress((event) => {
      renderSetupProgressEvent(event);
    });
    removeUpdateStatusListener = window.openclaw.onUpdateStatus((event) => {
      renderUpdateStatus(event);
      if (event.state === "downloading") {
        const bucket = Math.floor((event.progress || 0) / 20);
        if (bucket > lastUpdateLoggedProgressBucket) {
          appendLog(`Update: ${event.message} ${event.progress || 0}%`);
          lastUpdateLoggedProgressBucket = bucket;
        }
        return;
      }

      const key = `${event.state}:${event.message}`;
      if (key !== lastUpdateLogKey) {
        appendLog(`Update: ${event.message}`);
        lastUpdateLogKey = key;
      }
    });

    window.addEventListener("beforeunload", () => {
      stopWizardStatusPolling();
      if (typeof removeSetupProgressListener === "function") {
        removeSetupProgressListener();
      }
      if (typeof removeUpdateStatusListener === "function") {
        removeUpdateStatusListener();
      }
    });

    wireControlEvents();
    wireActions();
    resetWizardUi();
    await refreshUpdateStatus();
    await loadConfig();
    await refreshSetupState(true);
    await runEnvironmentCheck();
    setWorkspace("setup");
    maybeAutoHandoffToControl();
  } catch (error) {
    appendLog(`Bootstrap error: ${formatError(error)}`);
  }
}

void bootstrap();
