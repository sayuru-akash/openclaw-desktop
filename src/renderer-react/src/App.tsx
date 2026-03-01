import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType
} from "react";
import darkBrandLogo from "../../../assets/branding/openclaw_logo.png";
import lightBrandLogo from "../../../assets/branding/openclaw_logo_light_theme.png";
import {
  ArrowUpCircle,
  Bot,
  Boxes,
  Cable,
  ChevronRight,
  FileText,
  Folder,
  MessageSquare,
  Moon,
  PanelLeft,
  Power,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  Sun,
  Wrench
} from "lucide-react";
import type {
  AlwaysOnGatewayStatus,
  AppConfig,
  AuthSessionStatus,
  ChannelStatusItem,
  ChannelStatusResult,
  CommandResult,
  EnvironmentStatus,
  ModelStatusResult,
  SetupProgressEvent,
  SetupState,
  UpdateStatusEvent,
  WorkspaceEditableFileName,
  WorkspaceFilePayload
} from "../../shared/types";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { Select } from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset
} from "./components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";

const CONTROL_UI_URL = "http://127.0.0.1:18789/";

const DEFAULT_SETUP: SetupState = {
  stage: "idle",
  requiresReboot: false,
  message: "Setup has not started yet.",
  updatedAt: new Date(0).toISOString()
};

const FILE_OPTIONS: WorkspaceEditableFileName[] = [
  "openclaw.json",
  "soul.md",
  "skills.md",
  "bootstrap.md",
  "AGENTS.md",
  "HEARTBEAT.md"
];

type Workspace = "chat" | "setup" | "control";
type FeaturePane = "onboarding" | "channels" | "models" | "files" | "settings" | "updates" | "logs";
type ThemeMode = "dark" | "light";

interface NavItem {
  key: FeaturePane;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface StatusTableRow {
  label: string;
  value: string;
  variant: "default" | "success" | "warning" | "danger";
}

type OnboardingStepId = "welcome" | "runtime" | "openclaw" | "gateway" | "model" | "done";

interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  title: string;
  subtitle: string;
}

const onboardingSteps: OnboardingStep[] = [
  { id: "welcome", label: "Welcome", title: "Welcome", subtitle: "Sign in and set up OpenClaw." },
  { id: "runtime", label: "WSL", title: "Install WSL", subtitle: "Install WSL, Ubuntu, Node.js, npm, and Homebrew." },
  { id: "openclaw", label: "OpenClaw", title: "Install OpenClaw", subtitle: "Install OpenClaw CLI in WSL." },
  { id: "gateway", label: "Gateway", title: "Start Gateway", subtitle: "Start local gateway." },
  { id: "model", label: "Model", title: "Pick Model", subtitle: "Choose provider and model." },
  { id: "done", label: "Done", title: "Finish", subtitle: "Complete onboarding and open the app." }
];

const navItems: NavItem[] = [
  { key: "onboarding", label: "Onboarding", icon: Sparkles },
  { key: "channels", label: "Channels", icon: Cable },
  { key: "models", label: "Models", icon: Bot },
  { key: "files", label: "Files", icon: Folder },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "updates", label: "Updates", icon: ArrowUpCircle },
  { key: "logs", label: "Logs", icon: FileText }
];

function toVariant(value: boolean | null) {
  if (value === true) {
    return "success" as const;
  }
  if (value === false) {
    return "danger" as const;
  }
  return "warning" as const;
}

function readinessText(value: boolean | null, ok = "Ready", bad = "Missing") {
  if (value === null) {
    return "Pending";
  }
  return value ? ok : bad;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function setupStageLabel(stage: SetupState["stage"]): string {
  switch (stage) {
    case "checking_prereqs":
      return "Checking Prereqs";
    case "installing_wsl":
      return "Installing WSL";
    case "awaiting_reboot":
      return "Awaiting Restart";
    case "awaiting_wsl_user_setup":
      return "Awaiting Ubuntu User";
    case "installing_runtime":
      return "Installing Runtime";
    case "installing_homebrew":
      return "Installing Homebrew";
    case "installing_openclaw":
      return "Installing OpenClaw";
    case "running_onboarding":
      return "Running Onboarding";
    case "starting_gateway":
      return "Starting Gateway";
    case "ready_for_manual_step":
      return "Manual Step Needed";
    case "completed":
      return "Completed";
    case "failed":
      return "Needs Attention";
    case "idle":
    default:
      return "Not Started";
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function getChannel(result: ChannelStatusResult | null, channel: "whatsapp" | "telegram"): ChannelStatusItem {
  const fallback: ChannelStatusItem = {
    channel,
    configured: false,
    connected: false,
    summary: "Unknown",
    detail: "Not checked."
  };

  return result?.channels.find((item) => item.channel === channel) ?? fallback;
}

function summarizeCommandResult(title: string, result: CommandResult, appendLog: (line: string) => void) {
  const summary = `${title}: ${result.ok ? "ok" : "failed"}${result.code === null ? "" : ` (code ${result.code})`}`;
  appendLog(summary);

  const details = [result.stdout, result.stderr]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");

  if (details) {
    appendLog(details);
  }
}

function extractCommandFailureReason(result: CommandResult, fallbackTitle: string): string {
  const raw = [result.stderr, result.stdout].filter(Boolean).join("\n");
  const normalized = raw.replace(/\u0000/g, "").replace(/\ufeff/g, "").trim();
  if (!normalized) {
    return `${fallbackTitle} failed${result.code === null ? "." : ` (code ${result.code}).`}`;
  }

  if (/WSL_USER_SETUP_REQUIRED/i.test(normalized)) {
    return "Ubuntu account setup is required. Open Ubuntu, create username/password, then click Resume Setup.";
  }

  if (/Wsl\/EnumerateDistros\/Service\/E_ACCESSDENIED|E_ACCESSDENIED/i.test(normalized)) {
    return "WSL distro access was denied by Windows permissions in this session. Run the app in your normal user session and retry.";
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const last = lines[lines.length - 1] || normalized;
  return last.length > 260 ? `${last.slice(0, 257)}...` : last;
}

function throwIfCommandFailed(title: string, result: CommandResult): void {
  if (!result.ok) {
    throw new Error(extractCommandFailureReason(result, title));
  }
}

function toFriendlyFailureMessage(message: string): string {
  const normalized = message.replace(/\u0000/g, "").replace(/\ufeff/g, "").trim();
  if (!normalized) {
    return "Action failed. Please retry.";
  }

  if (/Wsl\/EnumerateDistros\/Service\/E_ACCESSDENIED|E_ACCESSDENIED|access is denied/i.test(normalized)) {
    return "Windows blocked WSL distro access for this session. Reopen OpenClaw Desktop in your normal user session and retry.";
  }

  if (/cancel|1602|1223|uac/i.test(normalized)) {
    return "WSL install was cancelled or denied. Click Install Ubuntu again and accept the Windows admin prompt.";
  }

  if (/restart|reboot|3010|1641/i.test(normalized)) {
    return "Windows restart is required before setup can continue.";
  }

  return normalized;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>("setup");
  const [pane, setPane] = useState<FeaturePane>("onboarding");
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [setupState, setSetupState] = useState<SetupState>(DEFAULT_SETUP);
  const [configDraft, setConfigDraft] = useState<AppConfig | null>(null);
  const [alwaysOnStatus, setAlwaysOnStatus] = useState<AlwaysOnGatewayStatus | null>(null);
  const [authSession, setAuthSession] = useState<AuthSessionStatus | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelStatusResult | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatusResult | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusEvent | null>(null);
  const [wizardStepIndex, setWizardStepIndex] = useState(0);
  const [workspaceFile, setWorkspaceFile] = useState<WorkspaceFilePayload | null>(null);
  const [selectedFile, setSelectedFile] = useState<WorkspaceEditableFileName>("openclaw.json");
  const [workspaceFileEditor, setWorkspaceFileEditor] = useState("");
  const [manageProvider, setManageProvider] = useState("");
  const [manageModel, setManageModel] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionProgressLabel, setActionProgressLabel] = useState("");
  const [actionProgressValue, setActionProgressValue] = useState(0);
  const [actionProgressState, setActionProgressState] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>(["App ready."]);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatStatusText, setChatStatusText] = useState("Waiting for gateway readiness check...");
  const [chatFallbackVisible, setChatFallbackVisible] = useState(false);
  const [controlStatusText, setControlStatusText] = useState("Waiting for gateway readiness check...");
  const [controlFallbackVisible, setControlFallbackVisible] = useState(false);
  const onboardingInitializedRef = useRef(false);

  const chatWebviewRef = useRef<any>(null);
  const controlWebviewRef = useRef<any>(null);
  const chatTabSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionProgressHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rebootAutoResumeAttemptedRef = useRef(false);
  const wslUserAutoResumeAttemptedRef = useRef(false);

  const runtimeReady = useMemo(() => {
    if (!environment) {
      return null;
    }

    return environment.wslReady
      && environment.wslUserConfigured
      && environment.nodeInstalled
      && environment.npmInstalled
      && environment.brewInstalled;
  }, [environment]);

  const missingRuntimeDependencies = useMemo(() => {
    if (!environment || !environment.wslReady || !environment.wslUserConfigured) {
      return [] as string[];
    }

    const missing: string[] = [];
    if (!environment.nodeInstalled) {
      missing.push("Node.js");
    }
    if (!environment.npmInstalled) {
      missing.push("npm");
    }
    if (!environment.brewInstalled) {
      missing.push("Homebrew");
    }
    return missing;
  }, [environment]);

  const runtimeInstallActionLabel = useMemo(() => {
    if (!environment) {
      return "Install WSL";
    }
    if (environment.wslAccessDenied) {
      return "Check WSL Permissions";
    }
    if (!environment.wslInstalled) {
      return "Install WSL";
    }
    if (!environment.wslDistroInstalled) {
      return `Install ${environment.wslDistro || "Ubuntu"}`;
    }
    if (!environment.wslReady) {
      return "Repair WSL";
    }
    if (missingRuntimeDependencies.length > 0) {
      if (missingRuntimeDependencies.length === 3) {
        return "Install WSL Runtime";
      }
      return `Install ${missingRuntimeDependencies.join(" + ")}`;
    }
    if (!environment.nodeInstalled || !environment.npmInstalled || !environment.brewInstalled) {
      return "Install WSL Runtime";
    }
    return "Repair WSL Runtime";
  }, [environment, missingRuntimeDependencies]);

  const gatewayReady = useMemo(() => {
    if (!environment) {
      return null;
    }

    return environment.isWindows && environment.wslReady && environment.openClawInstalled && environment.gatewayRunning;
  }, [environment]);

  const modelConfigured = useMemo(() => {
    const configuredProvider = configDraft?.modelProvider || modelStatus?.provider || "";
    const configuredModel = configDraft?.modelName || modelStatus?.model || "";
    return Boolean(configuredProvider && configuredModel);
  }, [configDraft?.modelName, configDraft?.modelProvider, modelStatus?.model, modelStatus?.provider]);

  const isBusy = Boolean(busyAction);
  const showActionProgress = actionProgressState !== "idle";
  const onboardingLocked = Boolean(configDraft && !configDraft.onboardingCompleted);
  const awaitingReboot = setupState.stage === "awaiting_reboot" || setupState.requiresReboot;
  const rebootStillPending = setupState.requiresReboot && !environment?.wslReady;
  const canResumeAfterReboot = setupState.stage === "awaiting_reboot" && Boolean(environment?.wslReady);
  const awaitingWslUserSetup = setupState.stage === "awaiting_wsl_user_setup"
    || Boolean(environment && environment.wslReady && !environment.wslUserConfigured);

  const runtimeGuidance = useMemo(() => {
    if (!environment) {
      return "Checking WSL and Ubuntu status...";
    }

    if (rebootStillPending || setupState.stage === "awaiting_reboot") {
      return "Windows restart is required. Click Restart Windows, then return and click Resume Setup.";
    }

    if (environment.wslAccessDenied) {
      return "Windows blocked WSL distro access for this session. Reopen OpenClaw Desktop in your normal user session, then retry.";
    }

    if (!environment.wslInstalled) {
      return "WSL is not installed yet. Click Install WSL and accept the Windows admin prompt.";
    }

    if (!environment.wslDistroInstalled) {
      return "Ubuntu is not installed yet. Click Install Ubuntu. If you already saw `wsl.exe exit code: 0`, click Refresh and wait briefly; if still missing, restart Windows once and retry.";
    }

    if (environment.wslReady && !environment.wslUserConfigured) {
      return "Ubuntu first-run setup is pending. Click Open Ubuntu Setup, create username/password, then click Resume Setup.";
    }

    if (environment.wslReady && environment.wslUserConfigured && missingRuntimeDependencies.length > 0) {
      if (missingRuntimeDependencies.length === 3) {
        return "WSL runtime dependencies are incomplete. Click Install WSL Runtime to install Node.js, npm, and Homebrew.";
      }
      return `WSL runtime dependencies are incomplete (${joinWithAnd(missingRuntimeDependencies)}). Click ${runtimeInstallActionLabel}.`;
    }

    if (runtimeReady) {
      return "Runtime is ready. Click Continue to move to the OpenClaw step.";
    }

    return "Click Install WSL to continue setup.";
  }, [environment, missingRuntimeDependencies, rebootStillPending, runtimeInstallActionLabel, runtimeReady, setupState.stage]);

  const clearActionProgressTimers = useCallback(() => {
    if (actionProgressTimerRef.current) {
      clearInterval(actionProgressTimerRef.current);
      actionProgressTimerRef.current = null;
    }
    if (actionProgressHideTimerRef.current) {
      clearTimeout(actionProgressHideTimerRef.current);
      actionProgressHideTimerRef.current = null;
    }
  }, []);

  const renderStatusTable = (rows: StatusTableRow[], compact = false) => (
    <div className="rounded-md border bg-muted/30">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={compact ? "h-8 text-xs" : "text-xs"}>Item</TableHead>
            <TableHead className={compact ? "h-8 text-xs text-right" : "text-xs text-right"}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className={compact ? "py-2 text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
                {row.label}
              </TableCell>
              <TableCell className={compact ? "py-2 text-right" : "text-right"}>
                <Badge variant={row.variant}>{row.value}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const renderActionProgress = () => {
    if (!showActionProgress) {
      return null;
    }

    const toneClass = actionProgressState === "failed" ? "bg-[#d56a76]" : "bg-foreground";
    const statusText = actionProgressState === "running"
      ? "Running"
      : actionProgressState === "done"
        ? "Completed"
        : "Failed";

    return (
      <Card className="border-dashed">
        <CardContent className="space-y-2 pt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{actionProgressLabel || "Working..."}</span>
            <span>{statusText} - {actionProgressValue}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all duration-300 ease-out ${toneClass}`}
              style={{ width: `${Math.max(0, Math.min(100, actionProgressValue))}%` }}
            />
          </div>
          {actionProgressState === "failed" && error ? (
            <p className="text-xs text-[#f3c2c8]">{toFriendlyFailureMessage(error)}</p>
          ) : null}
        </CardContent>
      </Card>
    );
  };

  const appendLog = useCallback((message: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    setLogs((current) => [line, ...current].slice(0, 300));
  }, []);

  const runAction = useCallback(async (
    label: string,
    fn: () => Promise<void>
  ): Promise<boolean> => {
    clearActionProgressTimers();
    setBusyAction(label);
    setError("");
    setActionProgressLabel(label);
    setActionProgressValue(8);
    setActionProgressState("running");
    appendLog(`${label}...`);
    actionProgressTimerRef.current = setInterval(() => {
      setActionProgressValue((current) => {
        if (current >= 95) {
          return current;
        }
        if (current < 35) {
          return current + 7;
        }
        if (current < 70) {
          return current + 4;
        }
        return current + 2;
      });
    }, 700);

    try {
      await fn();
      setActionProgressValue(100);
      setActionProgressState("done");
      appendLog(`${label}: done.`);
      return true;
    } catch (err) {
      const message = toFriendlyFailureMessage(formatError(err));
      setError(message);
      setActionProgressValue(100);
      setActionProgressState("failed");
      appendLog(`${label}: failed - ${message}`);
      return false;
    } finally {
      setBusyAction("");
      if (actionProgressTimerRef.current) {
        clearInterval(actionProgressTimerRef.current);
        actionProgressTimerRef.current = null;
      }
      actionProgressHideTimerRef.current = setTimeout(() => {
        setActionProgressState("idle");
        setActionProgressValue(0);
        setActionProgressLabel("");
      }, 1400);
    }
  }, [appendLog, clearActionProgressTimers]);

  const refreshEnvironmentSetup = useCallback(async (withLog = false) => {
    const [env, setup] = await Promise.all([
      window.openclaw.getEnvironmentStatus(),
      window.openclaw.getSetupState()
    ]);

    setEnvironment(env);
    setSetupState(setup);

    if (withLog) {
      appendLog("Environment refreshed.");
    }

    return env;
  }, [appendLog]);

  const refreshConfig = useCallback(async () => {
    const config = await window.openclaw.loadConfig();
    setConfigDraft(config);
    return config;
  }, []);

  const refreshAlwaysOn = useCallback(async () => {
    const status = await window.openclaw.getAlwaysOnGatewayStatus();
    setAlwaysOnStatus(status);
    return status;
  }, []);

  const refreshAuthSession = useCallback(async () => {
    const status = await window.openclaw.getAuthSessionStatus();
    setAuthSession(status);
    setConfigDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        accountAuthorized: status.authenticated,
        accountUserId: status.userId ?? ""
      };
    });

    return status;
  }, []);

  const refreshChannels = useCallback(async (withLog = false) => {
    const status = await window.openclaw.getChannelStatuses();
    setChannelStatus(status);
    if (withLog) {
      appendLog("Channels refreshed.");
    }
    return status;
  }, [appendLog]);

  const refreshModels = useCallback(async (withLog = false) => {
    const status = await window.openclaw.getModelStatus();
    setModelStatus(status);
    if (!manageProvider && status.provider) {
      setManageProvider(status.provider);
    }
    if (!manageModel && status.model) {
      setManageModel(status.model);
    }
    if (withLog) {
      appendLog(status.detail);
    }
    return status;
  }, [appendLog, manageModel, manageProvider]);

  const refreshUpdate = useCallback(async () => {
    const status = await window.openclaw.getUpdateStatus();
    setUpdateStatus(status);
    return status;
  }, []);

  const refreshAll = useCallback(async (withLog = false) => {
    const baselineResults = await Promise.allSettled([
      refreshConfig(),
      refreshAlwaysOn(),
      refreshUpdate(),
      refreshAuthSession()
    ]);

    for (const result of baselineResults) {
      if (result.status === "rejected") {
        appendLog(`Startup check failed: ${formatError(result.reason)}`);
      }
    }

    let env: EnvironmentStatus | null = null;
    try {
      env = await withTimeout(
        refreshEnvironmentSetup(withLog),
        20_000,
        "Environment check timed out."
      );
    } catch (err) {
      const message = formatError(err);
      setError((current) => current || message);
      appendLog(`Environment check failed: ${message}`);
    }

    if (env?.openClawInstalled) {
      const detailResults = await Promise.allSettled([refreshChannels(), refreshModels()]);
      for (const result of detailResults) {
        if (result.status === "rejected") {
          appendLog(`Startup detail check failed: ${formatError(result.reason)}`);
        }
      }
    }

    return env;
  }, [
    appendLog,
    refreshAlwaysOn,
    refreshAuthSession,
    refreshChannels,
    refreshConfig,
    refreshEnvironmentSetup,
    refreshModels,
    refreshUpdate
  ]);

  useEffect(() => {
    void refreshAll();

    const removeSetupProgressListener = window.openclaw.onSetupProgress((event: SetupProgressEvent) => {
      setSetupState((current) => ({
        ...current,
        stage: event.stage,
        message: event.message,
        updatedAt: event.timestamp
      }));
      setActionProgressValue((current) => {
        if (actionProgressState !== "running") {
          return current;
        }
        if (current >= 95) {
          return current;
        }
        return current + 1;
      });
      appendLog(`${event.stage}: ${event.message}`);
    });

    const removeUpdateStatusListener = window.openclaw.onUpdateStatus((event: UpdateStatusEvent) => {
      setUpdateStatus(event);
      appendLog(`Update: ${event.message}`);
    });

    return () => {
      removeSetupProgressListener();
      removeUpdateStatusListener();
    };
  }, [actionProgressState, appendLog, refreshAll]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("openclaw-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    window.localStorage.setItem("openclaw-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!configDraft || onboardingInitializedRef.current) {
      return;
    }
    onboardingInitializedRef.current = true;
    if (!configDraft.onboardingCompleted) {
      setWorkspace("setup");
      setPane("onboarding");
      setWizardStepIndex(0);
    }
  }, [configDraft]);

  const applyManagedModelProvider = (provider: string) => {
    setManageProvider(provider);
    const models = modelStatus?.modelsByProvider?.[provider] ?? [];
    setManageModel(models[0] || "");
  };

  const modelProviders = modelStatus?.availableProviders ?? [];
  const modelOptions = manageProvider ? modelStatus?.modelsByProvider?.[manageProvider] ?? [] : [];

  const settingsProvider = configDraft?.modelProvider ?? "";
  const settingsModelOptions = settingsProvider ? modelStatus?.modelsByProvider?.[settingsProvider] ?? [] : [];

  const installNode = () => runAction(runtimeInstallActionLabel, async () => {
    const result = await window.openclaw.installNodeRuntimeStreaming();
    summarizeCommandResult(runtimeInstallActionLabel, result, appendLog);
    throwIfCommandFailed(runtimeInstallActionLabel, result);
    await refreshAll();
  });

  const restartComputer = useCallback(() => runAction("Restart Windows", async () => {
    const result = await window.openclaw.restartComputer();
    summarizeCommandResult("Restart Windows", result, appendLog);
    throwIfCommandFailed("Restart Windows", result);
  }), [appendLog, runAction]);

  const openWslUserSetup = useCallback(() => runAction("Open Ubuntu setup", async () => {
    const result = await window.openclaw.openWslUserSetup();
    summarizeCommandResult("Open Ubuntu setup", result, appendLog);
    throwIfCommandFailed("Open Ubuntu setup", result);
    appendLog("Finish Ubuntu username/password in the opened terminal, then click Resume Setup.");
  }), [appendLog, runAction]);

  const resumeGuidedSetup = useCallback(() => runAction("Resume setup", async () => {
    const setup = await window.openclaw.runGuidedSetup();
    setSetupState(setup);
    appendLog(`Setup: ${setup.message}`);
    await refreshAll();
  }), [appendLog, refreshAll, runAction]);

  useEffect(() => {
    if (rebootAutoResumeAttemptedRef.current) {
      return;
    }
    if (!configDraft || configDraft.onboardingCompleted) {
      return;
    }
    if (!canResumeAfterReboot || isBusy) {
      return;
    }

    rebootAutoResumeAttemptedRef.current = true;
    appendLog("Restart detected. Resuming setup...");
    void resumeGuidedSetup();
  }, [appendLog, canResumeAfterReboot, configDraft, isBusy, resumeGuidedSetup]);

  useEffect(() => {
    if (!awaitingReboot) {
      rebootAutoResumeAttemptedRef.current = false;
    }
  }, [awaitingReboot]);

  useEffect(() => {
    if (wslUserAutoResumeAttemptedRef.current) {
      return;
    }
    if (!configDraft || configDraft.onboardingCompleted) {
      return;
    }
    if (!awaitingWslUserSetup || !environment?.wslUserConfigured || runtimeReady === true || isBusy) {
      return;
    }

    wslUserAutoResumeAttemptedRef.current = true;
    appendLog("Ubuntu account setup detected. Resuming setup...");
    void resumeGuidedSetup();
  }, [
    appendLog,
    awaitingWslUserSetup,
    configDraft,
    environment?.wslUserConfigured,
    isBusy,
    resumeGuidedSetup,
    runtimeReady
  ]);

  useEffect(() => {
    if (!awaitingWslUserSetup) {
      wslUserAutoResumeAttemptedRef.current = false;
    }
  }, [awaitingWslUserSetup]);

  useEffect(() => {
    if (!awaitingWslUserSetup || isBusy) {
      return;
    }

    const interval = setInterval(() => {
      void refreshEnvironmentSetup();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [awaitingWslUserSetup, isBusy, refreshEnvironmentSetup]);

  const installOpenClaw = () => runAction("OpenClaw install", async () => {
    const result = await window.openclaw.installOpenClawStreaming();
    summarizeCommandResult("OpenClaw install", result, appendLog);
    throwIfCommandFailed("OpenClaw install", result);
    await refreshAll();
  });

  const runCliOnboard = () => runAction("CLI onboarding", async () => {
    const result = await window.openclaw.runOnboarding();
    summarizeCommandResult("CLI onboard", result, appendLog);
    throwIfCommandFailed("CLI onboard", result);
    await refreshAll();
  });

  const startGateway = () => runAction("Gateway start", async () => {
    const result = await window.openclaw.gatewayStart();
    summarizeCommandResult("Gateway start", result, appendLog);
    throwIfCommandFailed("Gateway start", result);
    await refreshAll();
  });

  const stopGateway = () => runAction("Gateway stop", async () => {
    const result = await window.openclaw.gatewayStop();
    summarizeCommandResult("Gateway stop", result, appendLog);
    throwIfCommandFailed("Gateway stop", result);
    await refreshAll();
  });

  const completeOnboarding = () => runAction("Complete onboarding", async () => {
    const setup = await window.openclaw.completeOnboardingFromUi();
    setSetupState(setup);
    const nextConfig = await window.openclaw.saveConfig({ onboardingCompleted: true });
    setConfigDraft(nextConfig);
    await refreshAll();
    setWorkspace("chat");
  });

  const handleReconnectChannel = (channel: "whatsapp" | "telegram") => runAction(`${channel} reconnect`, async () => {
    const item = await window.openclaw.reconnectChannel(channel);
    appendLog(`${channel}: ${item.summary}`);
    await refreshChannels();
  });

  const handleDisableChannel = (channel: "whatsapp" | "telegram") => runAction(`${channel} disable`, async () => {
    const item = await window.openclaw.disableChannel(channel);
    appendLog(`${channel}: ${item.summary}`);
    await refreshChannels();
  });

  const saveTelegramToken = () => runAction("Telegram token", async () => {
    if (!telegramToken.trim()) {
      throw new Error("Bot token is required.");
    }

    const item = await window.openclaw.configureTelegramBot(telegramToken.trim());
    appendLog(`telegram: ${item.summary}`);
    setTelegramToken("");
    await refreshChannels();
  });

  const applyModelSelection = () => runAction("Apply model", async () => {
    if (!manageProvider || !manageModel) {
      throw new Error("Select provider and model first.");
    }

    const status = await window.openclaw.applyModelSelection(manageProvider, manageModel);
    setModelStatus(status);
    const nextConfig = await window.openclaw.saveConfig({
      modelProvider: manageProvider,
      modelName: manageModel
    });
    setConfigDraft(nextConfig);
    appendLog(status.detail);
  });

  const saveSettings = () => runAction("Save settings", async () => {
    if (!configDraft) {
      return;
    }

    const saved = await window.openclaw.saveConfig({
      profileName: configDraft.profileName,
      workspacePath: configDraft.workspacePath,
      modelProvider: configDraft.modelProvider,
      modelName: configDraft.modelName,
      modelApiKey: configDraft.modelApiKey,
      authWebBaseUrl: configDraft.authWebBaseUrl,
      accountAuthorized: configDraft.accountAuthorized,
      accountUserId: configDraft.accountUserId,
      autoStartGateway: configDraft.autoStartGateway,
      onboardingCompleted: configDraft.onboardingCompleted
    });

    setConfigDraft(saved);
    appendLog("Settings saved.");
  });

  const toggleAlwaysOn = (enabled: boolean) => runAction(enabled ? "Enable always-on" : "Disable always-on", async () => {
    const status = await window.openclaw.setAlwaysOnGatewayEnabled(enabled);
    setAlwaysOnStatus(status);
    appendLog(status.detail);
  });

  const loadWorkspaceFile = () => runAction(`Load ${selectedFile}`, async () => {
    if (!configDraft?.workspacePath) {
      throw new Error("Set workspace path in Settings first.");
    }

    const payload = await window.openclaw.getWorkspaceFile(configDraft.workspacePath, selectedFile);
    setWorkspaceFile(payload);
    setWorkspaceFileEditor(payload.content || "");
    appendLog(`Loaded ${selectedFile}.`);
  });

  const saveWorkspaceFile = () => runAction(`Save ${selectedFile}`, async () => {
    if (!configDraft?.workspacePath) {
      throw new Error("Set workspace path in Settings first.");
    }

    const payload = await window.openclaw.saveWorkspaceFile(configDraft.workspacePath, selectedFile, workspaceFileEditor);
    setWorkspaceFile(payload);
    appendLog(`Saved ${selectedFile}.`);
  });

  const checkForUpdates = () => runAction("Check updates", async () => {
    const status = await window.openclaw.checkForUpdates();
    setUpdateStatus(status);
    appendLog(status.message);
  });

  const installUpdate = () => runAction("Install update", async () => {
    await window.openclaw.installDownloadedUpdate();
    appendLog("Installer requested. App may restart.");
  });

  const completeAuthHandoff = () => runAction("Browser sign-in", async () => {
    const status = await window.openclaw.runAuthHandoff();
    setAuthSession(status);

    if (!status.reachable) {
      throw new Error(status.error || "Auth service is unreachable.");
    }

    const nextConfig = await window.openclaw.saveConfig({
      authWebBaseUrl: status.baseUrl,
      accountAuthorized: status.authenticated,
      accountUserId: status.userId ?? ""
    });
    setConfigDraft(nextConfig);

    if (!status.authenticated) {
      throw new Error(status.error || "Sign-in was not completed.");
    }
  });

  const verifyAuthSession = () => runAction("Verify sign-in", async () => {
    const status = await window.openclaw.getAuthSessionStatus();
    setAuthSession(status);

    if (!status.reachable) {
      throw new Error(status.error || "Auth service is unreachable.");
    }

    const nextConfig = await window.openclaw.saveConfig({
      accountAuthorized: status.authenticated,
      accountUserId: status.userId ?? ""
    });
    setConfigDraft(nextConfig);

    if (!status.authenticated) {
      throw new Error("You are not signed in yet.");
    }
  });

  const refreshAllAction = () => runAction("Refresh", async () => {
    await refreshAll(true);
  });

  const openWorkspace = (next: Workspace) => {
    if ((next === "chat" || next === "control") && onboardingLocked) {
      setWorkspace("setup");
      setPane("onboarding");
      appendLog("Finish onboarding before opening chat/control.");
      return;
    }

    setWorkspace(next);
  };

  const openFeaturePane = (next: FeaturePane) => {
    setWorkspace("setup");
    setPane(next);
  };

  const clearChatTabTimer = useCallback(() => {
    if (chatTabSelectionTimerRef.current) {
      clearTimeout(chatTabSelectionTimerRef.current);
      chatTabSelectionTimerRef.current = null;
    }
  }, []);

  const ensureChatTabSelected = useCallback((attempt = 0) => {
    if (workspace !== "chat") {
      return;
    }

    const chatWebview = chatWebviewRef.current;
    if (!chatWebview?.executeJavaScript) {
      return;
    }

    const script = `(() => {
      const nodes = [...document.querySelectorAll('button, [role="tab"], a')];
      const target = nodes.find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const label = (node.getAttribute('aria-label') || '').trim().toLowerCase();
        return text === 'chat' || label === 'chat' || text.includes('chat') || label.includes('chat');
      });
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })();`;

    chatWebview.executeJavaScript(script, true)
      .then((found: boolean) => {
        if (found) {
          setChatStatusText("Chat UI loaded.");
          return;
        }

        if (attempt < 10) {
          clearChatTabTimer();
          chatTabSelectionTimerRef.current = setTimeout(() => {
            ensureChatTabSelected(attempt + 1);
          }, 280);
        }
      })
      .catch(() => {
        if (attempt < 5) {
          clearChatTabTimer();
          chatTabSelectionTimerRef.current = setTimeout(() => {
            ensureChatTabSelected(attempt + 1);
          }, 380);
        }
      });
  }, [clearChatTabTimer, workspace]);

  const updateControlSurface = useCallback(() => {
    const ready = gatewayReady === true;
    const controlWebview = controlWebviewRef.current;

    if (!ready) {
      setControlStatusText("Gateway is not ready yet.");
      setControlFallbackVisible(true);
      if (controlWebview?.getAttribute && controlWebview.getAttribute("src") !== "about:blank") {
        controlWebview.setAttribute("src", "about:blank");
      }
      return;
    }

    setControlStatusText(`Connected to ${CONTROL_UI_URL}`);
    setControlFallbackVisible(false);
    if (controlWebview?.getAttribute && controlWebview.getAttribute("src") !== CONTROL_UI_URL) {
      controlWebview.setAttribute("src", CONTROL_UI_URL);
    }
  }, [gatewayReady]);

  const updateChatSurface = useCallback((ensureChatTab = false) => {
    const ready = gatewayReady === true;
    const chatWebview = chatWebviewRef.current;

    if (!ready) {
      setChatStatusText("Gateway is not ready yet.");
      setChatFallbackVisible(true);
      if (chatWebview?.getAttribute && chatWebview.getAttribute("src") !== "about:blank") {
        chatWebview.setAttribute("src", "about:blank");
      }
      return;
    }

    setChatStatusText(`Connected to ${CONTROL_UI_URL}`);
    setChatFallbackVisible(false);
    if (chatWebview?.getAttribute && chatWebview.getAttribute("src") !== CONTROL_UI_URL) {
      chatWebview.setAttribute("src", CONTROL_UI_URL);
      return;
    }

    if (ensureChatTab) {
      ensureChatTabSelected(0);
    }
  }, [ensureChatTabSelected, gatewayReady]);

  useEffect(() => {
    if (onboardingLocked) {
      return;
    }

    if (gatewayReady === true && workspace === "setup") {
      setWorkspace("chat");
      appendLog("Gateway is ready. Switched to in-app Chat.");
    }
  }, [appendLog, gatewayReady, onboardingLocked, workspace]);

  useEffect(() => {
    if (workspace === "chat") {
      updateChatSurface(true);
      return;
    }

    if (workspace === "control") {
      updateControlSurface();
      return;
    }

    clearChatTabTimer();
  }, [clearChatTabTimer, updateChatSurface, updateControlSurface, workspace]);

  useEffect(() => {
    const chatWebview = chatWebviewRef.current;
    if (!chatWebview?.addEventListener) {
      return;
    }

    const onDomReady = () => {
      if (chatWebview.getAttribute("src") === CONTROL_UI_URL) {
        setChatStatusText("Chat UI loaded.");
        ensureChatTabSelected(0);
      }
    };

    const onDidFailLoad = (event: any) => {
      if (event?.errorCode === -3) {
        return;
      }

      setChatStatusText("Could not load embedded Chat UI.");
      setChatFallbackVisible(true);
      appendLog(`Chat UI load failed (${event?.errorCode ?? "?"}): ${event?.errorDescription ?? "Unknown error"}`);
    };

    chatWebview.addEventListener("dom-ready", onDomReady);
    chatWebview.addEventListener("did-fail-load", onDidFailLoad);

    return () => {
      chatWebview.removeEventListener("dom-ready", onDomReady);
      chatWebview.removeEventListener("did-fail-load", onDidFailLoad);
    };
  }, [appendLog, ensureChatTabSelected, workspace]);

  useEffect(() => {
    const controlWebview = controlWebviewRef.current;
    if (!controlWebview?.addEventListener) {
      return;
    }

    const onDomReady = () => {
      if (controlWebview.getAttribute("src") === CONTROL_UI_URL) {
        setControlStatusText("Control UI loaded.");
      }
    };

    const onDidFailLoad = (event: any) => {
      if (event?.errorCode === -3) {
        return;
      }

      setControlStatusText("Could not load embedded Control UI.");
      setControlFallbackVisible(true);
      appendLog(`Control UI load failed (${event?.errorCode ?? "?"}): ${event?.errorDescription ?? "Unknown error"}`);
    };

    controlWebview.addEventListener("dom-ready", onDomReady);
    controlWebview.addEventListener("did-fail-load", onDidFailLoad);

    return () => {
      controlWebview.removeEventListener("dom-ready", onDomReady);
      controlWebview.removeEventListener("did-fail-load", onDidFailLoad);
    };
  }, [appendLog, workspace]);

  useEffect(() => {
    return () => {
      clearChatTabTimer();
    };
  }, [clearChatTabTimer]);

  useEffect(() => {
    return () => {
      clearActionProgressTimers();
    };
  }, [clearActionProgressTimers]);

  const renderOnboardingPane = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>First-Time Setup</CardTitle>
          <CardDescription>{setupState.message}</CardDescription>
        </CardHeader>
        <CardContent>
          {renderStatusTable([
            {
              label: "WSL",
              value: environment?.wslAccessDenied
                ? "Access denied"
                : readinessText(environment ? environment.wslInstalled : null, "Installed"),
              variant: environment?.wslAccessDenied
                ? toVariant(null)
                : toVariant(environment ? environment.wslInstalled : null)
            },
            {
              label: "Ubuntu distro",
              value: environment?.wslAccessDenied
                ? "Unknown"
                : readinessText(environment ? environment.wslDistroInstalled : null, "Installed"),
              variant: environment?.wslAccessDenied
                ? toVariant(null)
                : toVariant(environment ? environment.wslDistroInstalled : null)
            },
            {
              label: "Ubuntu user",
              value: environment?.wslAccessDenied
                ? "Unknown"
                : readinessText(environment ? environment.wslUserConfigured : null, "Configured"),
              variant: environment?.wslAccessDenied
                ? toVariant(null)
                : toVariant(environment ? environment.wslUserConfigured : null)
            },
            {
              label: "Node.js (WSL)",
              value: environment?.wslAccessDenied
                ? "Unknown"
                : readinessText(environment ? environment.nodeInstalled : null, "Installed"),
              variant: environment?.wslAccessDenied
                ? toVariant(null)
                : toVariant(environment ? environment.nodeInstalled : null)
            },
            {
              label: "npm (WSL)",
              value: environment?.wslAccessDenied
                ? "Unknown"
                : readinessText(environment ? environment.npmInstalled : null, "Installed"),
              variant: environment?.wslAccessDenied
                ? toVariant(null)
                : toVariant(environment ? environment.npmInstalled : null)
            },
            {
              label: "Homebrew (WSL)",
              value: environment?.wslAccessDenied
                ? "Unknown"
                : readinessText(environment ? environment.brewInstalled : null, "Installed"),
              variant: environment?.wslAccessDenied
                ? toVariant(null)
                : toVariant(environment ? environment.brewInstalled : null)
            },
            {
              label: "OpenClaw CLI",
              value: readinessText(environment ? environment.openClawInstalled : null, "Installed"),
              variant: toVariant(environment ? environment.openClawInstalled : null)
            },
            {
              label: "Gateway process",
              value: readinessText(environment ? environment.gatewayRunning : null, "Running", "Stopped"),
              variant: toVariant(environment ? environment.gatewayRunning : null)
            }
          ])}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Button onClick={installNode} disabled={isBusy || !environment?.isWindows || rebootStillPending}>
              <Wrench className="h-3.5 w-3.5" />
              {runtimeInstallActionLabel}
            </Button>
            <Button
              variant="outline"
              onClick={resumeGuidedSetup}
              disabled={isBusy || !(canResumeAfterReboot || (awaitingWslUserSetup && Boolean(environment?.wslUserConfigured)))}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Resume Setup
            </Button>
            <Button variant="outline" onClick={restartComputer} disabled={isBusy || !rebootStillPending || !environment?.isWindows}>
              <Power className="h-3.5 w-3.5" />
              Restart Windows
            </Button>
            <Button variant="outline" onClick={openWslUserSetup} disabled={isBusy || !awaitingWslUserSetup || !!environment?.wslUserConfigured}>
              <Wrench className="h-3.5 w-3.5" />
              Open Ubuntu Setup
            </Button>
            <Button onClick={installOpenClaw} disabled={isBusy || runtimeReady !== true}>
              <Bot className="h-3.5 w-3.5" />
              Install OpenClaw
            </Button>
            <Button onClick={startGateway} disabled={isBusy || !environment?.openClawInstalled}>
              <Play className="h-3.5 w-3.5" />
              Start Gateway
            </Button>
            <Button onClick={runCliOnboard} disabled={isBusy || !environment?.openClawInstalled}>
              <Settings className="h-3.5 w-3.5" />
              CLI Onboard
            </Button>
            <Button variant="outline" onClick={completeOnboarding} disabled={isBusy || gatewayReady !== true}>
              <Sparkles className="h-3.5 w-3.5" />
              Complete Onboarding
            </Button>
          </div>
        </CardContent>
      </Card>

      {renderActionProgress()}
    </div>
  );

  const whatsapp = getChannel(channelStatus, "whatsapp");
  const telegram = getChannel(channelStatus, "telegram");

  const renderChannelsPane = () => (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Channel Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="bg-muted/40">
              <CardHeader>
                <CardTitle className="text-sm">WhatsApp</CardTitle>
                <Badge variant={whatsapp.connected ? "success" : whatsapp.configured ? "warning" : "danger"}>{whatsapp.summary}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => void handleReconnectChannel("whatsapp")} disabled={isBusy || !environment?.openClawInstalled}>Reconnect</Button>
                  <Button variant="outline" onClick={() => void handleDisableChannel("whatsapp")} disabled={isBusy || !environment?.openClawInstalled}>Disable</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/40">
              <CardHeader>
                <CardTitle className="text-sm">Telegram</CardTitle>
                <Badge variant={telegram.connected ? "success" : telegram.configured ? "warning" : "danger"}>{telegram.summary}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => void handleReconnectChannel("telegram")} disabled={isBusy || !environment?.openClawInstalled}>Reconnect</Button>
                  <Button variant="outline" onClick={() => void handleDisableChannel("telegram")} disabled={isBusy || !environment?.openClawInstalled}>Disable</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={telegramToken}
              onChange={(event) => setTelegramToken(event.target.value)}
              placeholder="Bot token"
            />
            <Button onClick={saveTelegramToken} disabled={isBusy || !telegramToken.trim()}>Save Token</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderModelsPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Model Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Provider</p>
            <Select value={manageProvider} onChange={(event) => applyManagedModelProvider(event.target.value)}>
              <option value="">Select provider</option>
              {modelProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model</p>
            <Select value={manageModel} onChange={(event) => setManageModel(event.target.value)}>
              <option value="">Select model</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={applyModelSelection} disabled={isBusy || !manageProvider || !manageModel}>
            Apply Model
          </Button>
          <Button variant="outline" onClick={() => void runAction("Refresh models", async () => { await refreshModels(true); })} disabled={isBusy || !environment?.openClawInstalled}>
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderFilesPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
          <Select value={selectedFile} onChange={(event) => setSelectedFile(event.target.value as WorkspaceEditableFileName)}>
            {FILE_OPTIONS.map((file) => (
              <option key={file} value={file}>{file}</option>
            ))}
          </Select>
          <Button onClick={loadWorkspaceFile} disabled={isBusy || !configDraft?.workspacePath}>Load</Button>
          <Button variant="primary" onClick={saveWorkspaceFile} disabled={isBusy || !configDraft?.workspacePath}>Save</Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Path: {workspaceFile?.path ?? "Not loaded"}
        </p>

        <Textarea
          className="min-h-[340px] font-mono text-[11px]"
          value={workspaceFileEditor}
          onChange={(event) => setWorkspaceFileEditor(event.target.value)}
          placeholder="Load a file to edit"
        />
      </CardContent>
    </Card>
  );

  const renderSettingsPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Profile Name</p>
            <Input
              value={configDraft?.profileName ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, profileName: event.target.value } : current)}
              placeholder="Default"
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Workspace Path</p>
            <Input
              value={configDraft?.workspacePath ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, workspacePath: event.target.value } : current)}
              placeholder="C:\\Users\\You\\OpenClaw"
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model Provider</p>
            <Select
              value={configDraft?.modelProvider ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, modelProvider: event.target.value, modelName: "" } : current)}
            >
              <option value="">Select provider</option>
              {modelProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model Name</p>
            <Select
              value={configDraft?.modelName ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, modelName: event.target.value } : current)}
            >
              <option value="">Select model</option>
              {settingsModelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <p className="text-[11px] text-muted-foreground">Auth URL</p>
            <Input
              value={configDraft?.authWebBaseUrl ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, authWebBaseUrl: event.target.value } : current)}
              placeholder="https://auth.openclawdesk.top"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={Boolean(configDraft?.autoStartGateway)}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, autoStartGateway: event.target.checked } : current)}
            />
            Start gateway on app launch
          </label>

          <label className="flex items-center justify-between rounded-sm border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            <span>Always-on gateway (Windows sign-in)</span>
            <input
              type="checkbox"
              checked={Boolean(alwaysOnStatus?.enabled)}
              disabled={isBusy || !alwaysOnStatus?.supported}
              onChange={(event) => void toggleAlwaysOn(event.target.checked)}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">{alwaysOnStatus?.detail ?? "Checking..."}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={saveSettings} disabled={isBusy || !configDraft}>Save Settings</Button>
          <Button variant="outline" onClick={() => void runAction("Reload config", async () => { await refreshConfig(); })} disabled={isBusy}>Reload</Button>
        </div>
      </CardContent>
    </Card>
  );

  const canInstallUpdate = updateStatus?.state === "downloaded" && updateStatus?.canInstall;

  const renderUpdatesPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          State: {updateStatus?.state ?? "idle"}
          {typeof updateStatus?.progress === "number" ? ` (${Math.round(updateStatus.progress)}%)` : ""}
        </p>

        <div className="flex gap-2">
          <Button onClick={checkForUpdates} disabled={isBusy}>Check</Button>
          <Button variant="primary" onClick={installUpdate} disabled={isBusy || !canInstallUpdate}>Install + Restart</Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderLogsPane = () => (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Live Log</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="h-[calc(100vh-13rem)] overflow-auto rounded-sm border border-border bg-[#141414] p-3 text-[11px] leading-5 text-muted-foreground">
          {logs.join("\n")}
        </pre>
      </CardContent>
    </Card>
  );

  const renderSetupWorkspace = () => {
    const selectedNav = navItems.find((item) => item.key === pane);

    const renderSelectedPane = () => {
      switch (pane) {
        case "onboarding":
          return renderOnboardingPane();
        case "channels":
          return renderChannelsPane();
        case "models":
          return renderModelsPane();
        case "files":
          return renderFilesPane();
        case "settings":
          return renderSettingsPane();
        case "updates":
          return renderUpdatesPane();
        case "logs":
          return renderLogsPane();
        default:
          return renderOnboardingPane();
      }
    };

    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">{selectedNav?.label ?? "Setup"}</h3>
        </div>
        {renderSelectedPane()}
      </div>
    );
  };

  const renderWebviewWorkspace = (mode: "chat" | "control") => {
    const isChat = mode === "chat";
    const title = isChat ? "Chat" : "Control";
    const webviewRef = isChat ? chatWebviewRef : controlWebviewRef;
    const ready = gatewayReady === true;
    const statusText = isChat ? chatStatusText : controlStatusText;
    const fallbackVisible = isChat ? chatFallbackVisible : controlFallbackVisible;
    const fallbackText = "Gateway is not ready. Start + Retry.";

    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{statusText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (!ready) {
                  return;
                }
                webviewRef.current?.reload?.();
                appendLog(`Reloaded embedded ${title} UI.`);
              }}
              disabled={!ready}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload
            </Button>
            <Button onClick={startGateway} disabled={isBusy || !environment?.openClawInstalled}>
              <Play className="h-3.5 w-3.5" />
              {isChat ? "Start Gateway" : "Start + Retry"}
            </Button>
            {isChat ? (
              <Button
                variant="outline"
                onClick={() => setWorkspace("control")}
                disabled={onboardingLocked}
              >
                <Boxes className="h-3.5 w-3.5" />
                Open Control
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setWorkspace("setup")}>
                <Wrench className="h-3.5 w-3.5" />
                Back to Setup
              </Button>
            )}
          </div>

          {fallbackVisible ? (
            <p className="text-xs text-[#d2bb86]">{fallbackText}</p>
          ) : null}

          <webview
            ref={webviewRef}
            className="h-[calc(100vh-16.5rem)] w-full rounded-sm border border-border bg-[#141414]"
            src={ready ? CONTROL_UI_URL : "about:blank"}
            allowpopups={false}
            partition="persist:openclaw-control"
          />
        </CardContent>
      </Card>
    );
  };

  const currentOnboardingStep = onboardingSteps[wizardStepIndex] ?? onboardingSteps[0];
  const canGoBackOnboarding = wizardStepIndex > 0;

  const onboardingStepDone = (stepId: OnboardingStepId) => {
    switch (stepId) {
      case "welcome":
        return Boolean(configDraft?.accountAuthorized);
      case "runtime":
        return runtimeReady === true;
      case "openclaw":
        return Boolean(environment?.openClawInstalled);
      case "gateway":
        return Boolean(environment?.gatewayRunning);
      case "model":
        return modelConfigured;
      case "done":
        return Boolean(configDraft?.onboardingCompleted);
      default:
        return false;
    }
  };

  const advanceOnboarding = () => {
    setWizardStepIndex((current) => Math.min(current + 1, onboardingSteps.length - 1));
  };

  const retreatOnboarding = () => {
    setWizardStepIndex((current) => Math.max(current - 1, 0));
  };

  const runOnboardingStepPrimary = async () => {
    const step = currentOnboardingStep.id;

    if (step === "welcome") {
      if (configDraft?.accountAuthorized) {
        advanceOnboarding();
        return;
      }

      const ok = await completeAuthHandoff();
      if (!ok) {
        return;
      }
      advanceOnboarding();
      return;
    }

    if (step === "runtime") {
      if (environment?.wslAccessDenied) {
        setError("Windows blocked WSL distro access for this session. Reopen OpenClaw Desktop in your normal user session and retry.");
        return;
      }
      if (awaitingWslUserSetup && !environment?.wslUserConfigured) {
        await openWslUserSetup();
        return;
      }
      if (rebootStillPending) {
        await restartComputer();
        return;
      }
      if ((canResumeAfterReboot || awaitingWslUserSetup) && runtimeReady !== true) {
        const ok = await resumeGuidedSetup();
        if (!ok) {
          return;
        }
        const env = await refreshEnvironmentSetup();
        if (env.wslReady && env.wslUserConfigured && env.nodeInstalled && env.npmInstalled && env.brewInstalled) {
          advanceOnboarding();
        }
        return;
      }
      if (runtimeReady) {
        advanceOnboarding();
        return;
      }
      const ok = await installNode();
      if (!ok) {
        return;
      }
      const env = await refreshEnvironmentSetup();
      if (env.wslReady && env.wslUserConfigured && env.nodeInstalled && env.npmInstalled && env.brewInstalled) {
        advanceOnboarding();
      }
      return;
    }

    if (step === "openclaw") {
      if (environment?.openClawInstalled) {
        advanceOnboarding();
        return;
      }
      const ok = await installOpenClaw();
      if (!ok) {
        return;
      }
      const env = await refreshEnvironmentSetup();
      if (env.openClawInstalled) {
        advanceOnboarding();
      }
      return;
    }

    if (step === "gateway") {
      if (environment?.gatewayRunning) {
        advanceOnboarding();
        return;
      }
      const ok = await startGateway();
      if (!ok) {
        return;
      }
      const env = await refreshEnvironmentSetup();
      if (env.gatewayRunning) {
        advanceOnboarding();
      }
      return;
    }

    if (step === "model") {
      if (modelConfigured) {
        advanceOnboarding();
        return;
      }
      if (!manageProvider || !manageModel) {
        setError("Select provider and model.");
        return;
      }
      const ok = await applyModelSelection();
      if (!ok) {
        return;
      }
      const status = await refreshModels();
      if (status.provider && status.model) {
        advanceOnboarding();
      }
      return;
    }

    if (step === "done") {
      const ok = await completeOnboarding();
      if (!ok) {
        return;
      }
      const config = await refreshConfig();
      if (config.onboardingCompleted) {
        setWizardStepIndex(0);
        setWorkspace("chat");
      }
    }
  };

  const onboardingPrimaryLabel = (() => {
    switch (currentOnboardingStep.id) {
      case "welcome":
        return configDraft?.accountAuthorized ? "Continue" : "Sign In";
      case "runtime":
        if (awaitingWslUserSetup && !environment?.wslUserConfigured) {
          return "Open Ubuntu Setup";
        }
        if (rebootStillPending) {
          return "Restart Windows";
        }
        if ((canResumeAfterReboot || awaitingWslUserSetup) && runtimeReady !== true) {
          return "Resume Setup";
        }
        return runtimeReady ? "Continue" : runtimeInstallActionLabel;
      case "openclaw":
        return environment?.openClawInstalled ? "Continue" : "Install OpenClaw";
      case "gateway":
        return environment?.gatewayRunning ? "Continue" : "Start Gateway";
      case "model":
        return modelConfigured ? "Continue" : "Apply Model";
      case "done":
        return "Enter App";
      default:
        return "Continue";
    }
  })();

  const isWelcomeStep = currentOnboardingStep.id === "welcome";
  const brandLogoSrc = theme === "light" ? lightBrandLogo : darkBrandLogo;

  const renderOnboardingWizard = () => (
    <div className="h-full w-full bg-background p-4">
      <div className="mx-auto flex h-full max-w-[1320px] flex-col rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-2xl font-bold tracking-tight">Onboarding</p>
            <p className="text-xs text-muted-foreground">
              Step {wizardStepIndex + 1} of {onboardingSteps.length}
            </p>
          </div>
          <div className="flex items-center flex-wrap gap-y-2">
            {onboardingSteps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className="flex flex-col">
                  <span className={`text-xs font-medium ${index === wizardStepIndex ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.label}
                  </span>
                  <div className={`mt-1 h-0.5 rounded-full ${index <= wizardStepIndex ? "bg-foreground" : "bg-muted"}`} />
                </div>
                {index < onboardingSteps.length - 1 && (
                  <ChevronRight className="mx-3 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] max-[1100px]:grid-cols-1">
          <section className="flex min-h-0 flex-col p-8">
            <div className="mb-6">
              {canGoBackOnboarding ? (
                <Button variant="ghost" className="mb-4 px-0 text-sm" onClick={retreatOnboarding}>
                  Back
                </Button>
              ) : null}
              <h2 className="text-4xl font-semibold tracking-tight">{currentOnboardingStep.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{currentOnboardingStep.subtitle}</p>
            </div>

            <div className="flex-1 space-y-4">
              {currentOnboardingStep.id === "welcome" ? (
                <Card>
                  <CardContent className="space-y-3 pt-5 text-sm text-muted-foreground">
                    <p>{configDraft?.authWebBaseUrl || authSession?.baseUrl}</p>
                    <div className="flex items-center gap-2">
                      <span>Session</span>
                      <Badge variant={configDraft?.accountAuthorized ? "success" : "warning"}>
                        {configDraft?.accountAuthorized ? "Signed in" : "Signed out"}
                      </Badge>
                    </div>
                    {configDraft?.accountUserId ? (
                      <p className="text-xs">User: {configDraft.accountUserId}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void completeAuthHandoff()} disabled={isBusy}>
                        Sign In
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {currentOnboardingStep.id === "runtime" ? (
                <div className="space-y-3">
                  {renderStatusTable([
                    {
                      label: "WSL",
                      value: environment?.wslAccessDenied
                        ? "Access denied"
                        : readinessText(environment ? environment.wslInstalled : null, "Installed"),
                      variant: environment?.wslAccessDenied
                        ? toVariant(null)
                        : toVariant(environment ? environment.wslInstalled : null)
                    },
                    {
                      label: "Ubuntu distro",
                      value: environment?.wslAccessDenied
                        ? "Unknown"
                        : readinessText(environment ? environment.wslDistroInstalled : null, "Installed"),
                      variant: environment?.wslAccessDenied
                        ? toVariant(null)
                        : toVariant(environment ? environment.wslDistroInstalled : null)
                    },
                    {
                      label: "Ubuntu user",
                      value: environment?.wslAccessDenied
                        ? "Unknown"
                        : readinessText(environment ? environment.wslUserConfigured : null, "Configured"),
                      variant: environment?.wslAccessDenied
                        ? toVariant(null)
                        : toVariant(environment ? environment.wslUserConfigured : null)
                    },
                    {
                      label: "Node.js (WSL)",
                      value: environment?.wslAccessDenied
                        ? "Unknown"
                        : readinessText(environment ? environment.nodeInstalled : null, "Installed"),
                      variant: environment?.wslAccessDenied
                        ? toVariant(null)
                        : toVariant(environment ? environment.nodeInstalled : null)
                    },
                    {
                      label: "npm (WSL)",
                      value: environment?.wslAccessDenied
                        ? "Unknown"
                        : readinessText(environment ? environment.npmInstalled : null, "Installed"),
                      variant: environment?.wslAccessDenied
                        ? toVariant(null)
                        : toVariant(environment ? environment.npmInstalled : null)
                    },
                    {
                      label: "Homebrew (WSL)",
                      value: environment?.wslAccessDenied
                        ? "Unknown"
                        : readinessText(environment ? environment.brewInstalled : null, "Installed"),
                      variant: environment?.wslAccessDenied
                        ? toVariant(null)
                        : toVariant(environment ? environment.brewInstalled : null)
                    }
                  ])}
                  {environment?.wslAccessDenied ? (
                    <Card>
                      <CardContent className="pt-4 text-sm text-muted-foreground">
                        WSL is present, but this session cannot enumerate distros due to Windows permissions (`E_ACCESSDENIED`).
                        Run OpenClaw Desktop in your normal user session and verify WSL access with `wsl -l -v`.
                      </CardContent>
                    </Card>
                  ) : null}
                  {awaitingReboot || awaitingWslUserSetup ? (
                    <Card>
                      <CardContent className="pt-4 text-sm text-muted-foreground">
                        {awaitingWslUserSetup && !environment?.wslUserConfigured
                          ? "Ubuntu account setup is required. Click Open Ubuntu Setup, create username/password, then click Resume Setup."
                          : rebootStillPending
                            ? "Windows restart is required to continue setup."
                            : "Restart/setup prerequisites completed. Click Resume Setup to continue from where you left off."}
                      </CardContent>
                    </Card>
                  ) : null}
                  <Card>
                    <CardContent className="pt-4 text-sm text-muted-foreground">
                      {runtimeGuidance}
                    </CardContent>
                  </Card>
                  {setupState.stage === "failed" ? (
                    <Card>
                      <CardContent className="pt-4 text-sm text-[#f3c2c8]">
                        {toFriendlyFailureMessage(setupState.message)}
                      </CardContent>
                    </Card>
                  ) : null}
                  {error ? (
                    <Card>
                      <CardContent className="pt-4 text-sm text-[#f3c2c8]">
                        {toFriendlyFailureMessage(error)}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              ) : null}

              {currentOnboardingStep.id === "openclaw" ? (
                renderStatusTable([
                  {
                    label: "OpenClaw CLI",
                    value: readinessText(environment ? environment.openClawInstalled : null, "Installed"),
                    variant: toVariant(environment ? environment.openClawInstalled : null)
                  }
                ])
              ) : null}

              {currentOnboardingStep.id === "gateway" ? (
                renderStatusTable([
                  {
                    label: "Gateway",
                    value: readinessText(environment ? environment.gatewayRunning : null, "Running", "Stopped"),
                    variant: toVariant(environment ? environment.gatewayRunning : null)
                  }
                ])
              ) : null}

              {currentOnboardingStep.id === "model" ? (
                <Card>
                  <CardContent className="space-y-3 pt-5">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Provider</p>
                      <Select value={manageProvider} onChange={(event) => applyManagedModelProvider(event.target.value)}>
                        <option value="">Select provider</option>
                        {modelProviders.map((provider) => (
                          <option key={provider} value={provider}>{provider}</option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Model</p>
                      <Select value={manageModel} onChange={(event) => setManageModel(event.target.value)}>
                        <option value="">Select model</option>
                        {modelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {currentOnboardingStep.id === "done" ? (
                <Card>
                  <CardContent className="pt-5 text-sm text-muted-foreground">
                    {onboardingStepDone("model") ? "Everything is ready." : "Complete previous steps first."}
                  </CardContent>
                </Card>
              ) : null}
            </div>

            {renderActionProgress()}

            <div className="mt-6">
              <Button
                variant="primary"
                className="h-12 px-8 text-base font-semibold"
                onClick={() => void runOnboardingStepPrimary()}
                disabled={isBusy || (currentOnboardingStep.id === "done" && !onboardingStepDone("model"))}
              >
                {onboardingPrimaryLabel}
              </Button>
            </div>
          </section>

          <aside className="border-l bg-muted/20 p-6 max-[1100px]:border-l-0 max-[1100px]:border-t">
            <div className="flex h-full items-center justify-center rounded-lg border bg-card/80 p-10">
              <img src={brandLogoSrc} alt="OpenClaw" className="h-auto w-full max-w-[360px]" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );

  if (!configDraft) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!configDraft.onboardingCompleted) {
    return renderOnboardingWizard();
  }

  const workspaceTitle = workspace === "setup" ? "Setup" : workspace === "chat" ? "Chat" : "Control";
  const workspaceDescription = workspace === "setup"
    ? "Install and control"
    : workspace === "chat"
      ? "Live chat"
      : "Gateway control";

  return (
    <Tabs value={workspace} onValueChange={(value) => openWorkspace(value as Workspace)} className="h-full w-full bg-sidebar p-3">
      <div className={`grid h-full gap-3 max-[1360px]:grid-cols-1 ${sidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)_320px]" : "grid-cols-[290px_minmax(0,1fr)_320px]"}`}>
        <Sidebar>
          <SidebarHeader>
            <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
              {!sidebarCollapsed && <img src={brandLogoSrc} alt="OpenClaw" className="h-auto w-36" />}
              <Button
                variant="ghost"
                className="flex-shrink-0 px-2"
                onClick={() => setSidebarCollapsed((c) => !c)}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              {!sidebarCollapsed && <SidebarGroupLabel>Workspace</SidebarGroupLabel>}
              <SidebarGroupContent>
                <TabsList className="grid h-auto grid-cols-1 gap-1 bg-transparent p-0">
                  <TabsTrigger value="setup" className={`gap-2 ${sidebarCollapsed ? "justify-center px-0" : "justify-start"}`} title={sidebarCollapsed ? "Setup" : undefined}>
                    <Wrench className="h-5 w-5 flex-shrink-0" />
                    {!sidebarCollapsed && "Setup"}
                  </TabsTrigger>
                  <TabsTrigger value="chat" className={`gap-2 ${sidebarCollapsed ? "justify-center px-0" : "justify-start"}`} title={sidebarCollapsed ? "Chat" : undefined}>
                    <MessageSquare className="h-5 w-5 flex-shrink-0" />
                    {!sidebarCollapsed && "Chat"}
                  </TabsTrigger>
                  <TabsTrigger value="control" className={`gap-2 ${sidebarCollapsed ? "justify-center px-0" : "justify-start"}`} title={sidebarCollapsed ? "Control" : undefined}>
                    <Boxes className="h-5 w-5 flex-shrink-0" />
                    {!sidebarCollapsed && "Control"}
                  </TabsTrigger>
                </TabsList>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              {!sidebarCollapsed && <SidebarGroupLabel>Sections</SidebarGroupLabel>}
              <SidebarGroupContent>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = workspace === "setup" && pane === item.key;
                  return (
                    <Button
                      key={item.key}
                      variant={active ? "primary" : "ghost"}
                      className={`w-full ${sidebarCollapsed ? "justify-center px-0" : "justify-start"}`}
                      onClick={() => openFeaturePane(item.key)}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      {!sidebarCollapsed && item.label}
                    </Button>
                  );
                })}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

        </Sidebar>

        <SidebarInset className="overflow-hidden p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{workspaceTitle}</h2>
              <p className="text-xs text-muted-foreground">{workspaceDescription}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="default">{setupStageLabel(setupState.stage)}</Badge>
              <Button
                variant="outline"
                className="px-2"
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="outline" onClick={refreshAllAction} disabled={isBusy}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          <Separator className="my-4" />

          <TabsContent value="setup" className="mt-0 h-[calc(100%-6rem)] min-h-0">
            <ScrollArea className="h-full pr-1">
              {renderSetupWorkspace()}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="chat" className="mt-0 h-[calc(100%-6rem)]">
            {renderWebviewWorkspace("chat")}
          </TabsContent>
          <TabsContent value="control" className="mt-0 h-[calc(100%-6rem)]">
            {renderWebviewWorkspace("control")}
          </TabsContent>
        </SidebarInset>

        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Quick Actions</h2>
              {busyAction ? <Badge variant="warning">Working</Badge> : <Badge variant="default">Idle</Badge>}
            </div>
          </SidebarHeader>

          <SidebarContent className="px-3">
            <div className="grid grid-cols-1 gap-2">
              <Button onClick={startGateway} disabled={isBusy || !environment?.openClawInstalled}>
                <Play className="h-4 w-4" />
                Start Gateway
              </Button>
              <Button onClick={stopGateway} disabled={isBusy || !environment?.openClawInstalled}>
                <Square className="h-4 w-4" />
                Stop Gateway
              </Button>
            </div>

            <Separator className="my-4" />

            {renderStatusTable([
              {
                label: "WSL Runtime",
                value: readinessText(runtimeReady, "Ready", "Missing"),
                variant: toVariant(runtimeReady)
              },
              {
                label: "OpenClaw",
                value: readinessText(environment ? environment.openClawInstalled : null, "Installed"),
                variant: toVariant(environment ? environment.openClawInstalled : null)
              },
              {
                label: "Gateway",
                value: readinessText(environment ? environment.gatewayRunning : null, "Running", "Stopped"),
                variant: toVariant(environment ? environment.gatewayRunning : null)
              },
              {
                label: "Onboarding",
                value: configDraft?.onboardingCompleted ? "Completed" : "Pending",
                variant: configDraft?.onboardingCompleted ? "success" : "warning"
              }
            ])}

            <Separator className="my-4" />

            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">System Notes</p>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {(environment?.notes ?? ["No notes."]).map((note) => (
                <li key={note}>- {note}</li>
              ))}
            </ul>
          </SidebarContent>

          <SidebarFooter>
            {busyAction ? (
              <p className="text-xs text-muted-foreground">Working: {busyAction}</p>
            ) : null}
            {error ? <p className="mt-1 text-xs text-[#f3c2c8]">{error}</p> : null}
          </SidebarFooter>
        </Sidebar>
      </div>
    </Tabs>
  );
}
