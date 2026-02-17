export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SetupStage =
  | "idle"
  | "installing_wsl"
  | "awaiting_reboot"
  | "resuming_after_reboot"
  | "installing_openclaw"
  | "running_onboarding"
  | "starting_gateway"
  | "ready_for_manual_step"
  | "completed"
  | "failed";

export interface SetupState {
  stage: SetupStage;
  requiresReboot: boolean;
  resumeOnLogin: boolean;
  message: string;
  updatedAt: string;
}

export interface SetupProgressEvent {
  timestamp: string;
  stage: SetupStage;
  level: "info" | "warning" | "error";
  source: "setup" | "stdout" | "stderr";
  message: string;
}

export type WizardRunStatus = "running" | "done" | "cancelled" | "error";
export type WizardStepType = "note" | "select" | "text" | "confirm" | "multiselect" | "progress" | "action";

export interface WizardStepOption {
  value: unknown;
  label: string;
  hint?: string;
}

export interface WizardStep {
  id: string;
  type: WizardStepType;
  title?: string;
  message?: string;
  options?: WizardStepOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: "gateway" | "client";
}

export interface WizardStartParams {
  mode?: "local" | "remote";
  workspace?: string;
}

export interface WizardAnswer {
  stepId: string;
  value?: unknown;
}

export interface WizardStartResult {
  sessionId: string;
  done: boolean;
  step?: WizardStep;
  status?: WizardRunStatus;
  error?: string;
}

export interface WizardNextResult {
  done: boolean;
  step?: WizardStep;
  status?: WizardRunStatus;
  error?: string;
}

export interface WizardStatusResult {
  status: WizardRunStatus;
  error?: string;
}

export interface EnvironmentStatus {
  checkedAt: string;
  platform: NodeJS.Platform;
  isWindows: boolean;
  wslInstalled: boolean;
  distroInstalled: boolean;
  systemdEnabled: boolean;
  openClawInstalled: boolean;
  gatewayRunning: boolean;
  notes: string[];
}

export interface AppConfig {
  profileName: string;
  workspacePath: string;
  modelProvider: string;
  modelName: string;
  autoStartGateway: boolean;
  updatedAt: string;
}

export interface RendererApi {
  getEnvironmentStatus: () => Promise<EnvironmentStatus>;
  installWsl: () => Promise<CommandResult>;
  installOpenClaw: () => Promise<CommandResult>;
  runOnboarding: () => Promise<CommandResult>;
  gatewayStatus: () => Promise<CommandResult>;
  gatewayStart: () => Promise<CommandResult>;
  gatewayStop: () => Promise<CommandResult>;
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  getSetupState: () => Promise<SetupState>;
  runGuidedSetup: () => Promise<SetupState>;
  startWslSetup: () => Promise<SetupState>;
  resumeSetup: () => Promise<SetupState>;
  restartForSetup: () => Promise<CommandResult>;
  onSetupProgress: (listener: (event: SetupProgressEvent) => void) => () => void;
  wizardStart: (params?: WizardStartParams) => Promise<WizardStartResult>;
  wizardNext: (sessionId: string, answer?: WizardAnswer) => Promise<WizardNextResult>;
  wizardStatus: (sessionId: string) => Promise<WizardStatusResult>;
  wizardCancel: (sessionId: string) => Promise<{ status: WizardRunStatus; error?: string }>;
  completeOnboardingFromUi: () => Promise<SetupState>;
}
