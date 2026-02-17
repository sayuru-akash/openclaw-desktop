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
}
