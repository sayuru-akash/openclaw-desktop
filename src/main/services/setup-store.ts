import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SetupStage, SetupState } from "../../shared/types";

const defaultState: SetupState = {
  stage: "idle",
  requiresReboot: false,
  message: "Setup has not started yet.",
  updatedAt: new Date(0).toISOString()
};

const LEGACY_WSL_STAGES = new Set(["installing_wsl", "awaiting_reboot", "resuming_after_reboot"]);

function sanitizeMessage(message: unknown): string {
  if (typeof message !== "string" || !message.trim()) {
    return defaultState.message;
  }

  if (/wsl/i.test(message)) {
    return "Legacy setup state detected. Run guided setup again for native Windows mode.";
  }

  return message;
}

function normalizeStage(stage: unknown): { stage: SetupStage; migratedFromLegacy: boolean } {
  if (typeof stage !== "string") {
    return { stage: defaultState.stage, migratedFromLegacy: false };
  }

  if (LEGACY_WSL_STAGES.has(stage)) {
    return { stage: "failed", migratedFromLegacy: true };
  }

  const allowed: SetupStage[] = [
    "idle",
    "checking_prereqs",
    "installing_node",
    "installing_openclaw",
    "running_onboarding",
    "starting_gateway",
    "ready_for_manual_step",
    "completed",
    "failed"
  ];
  if (allowed.includes(stage as SetupStage)) {
    return { stage: stage as SetupStage, migratedFromLegacy: false };
  }

  return { stage: defaultState.stage, migratedFromLegacy: false };
}

export class SetupStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "setup-state.json");
  }

  public async load(): Promise<SetupState> {
    try {
      const payload = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(payload) as Partial<SetupState>;
      const normalizedStage = normalizeStage(parsed.stage);

      return {
        stage: normalizedStage.stage,
        requiresReboot: parsed.requiresReboot ?? defaultState.requiresReboot,
        message: normalizedStage.migratedFromLegacy
          ? "Legacy setup state detected. Run guided setup again for native Windows mode."
          : sanitizeMessage(parsed.message),
        updatedAt: parsed.updatedAt ?? defaultState.updatedAt
      };
    } catch {
      return { ...defaultState };
    }
  }

  public async save(next: Partial<SetupState>): Promise<SetupState> {
    const current = await this.load();
    const merged: SetupState = {
      ...current,
      ...next,
      updatedAt: new Date().toISOString()
    };

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");

    return merged;
  }
}
