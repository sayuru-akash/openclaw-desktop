import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SetupStage, SetupState } from "../../shared/types";

const defaultState: SetupState = {
  stage: "idle",
  requiresReboot: false,
  message: "Setup has not started yet.",
  updatedAt: new Date(0).toISOString()
};

function sanitizeMessage(message: unknown): string {
  if (typeof message !== "string" || !message.trim()) {
    return defaultState.message;
  }

  return message;
}

function normalizeStage(stage: unknown): SetupStage {
  if (typeof stage !== "string") {
    return defaultState.stage;
  }

  const allowed: SetupStage[] = [
    "idle",
    "checking_prereqs",
    "installing_wsl",
    "awaiting_reboot",
    "installing_runtime",
    "installing_openclaw",
    "running_onboarding",
    "starting_gateway",
    "ready_for_manual_step",
    "completed",
    "failed"
  ];
  if (allowed.includes(stage as SetupStage)) {
    return stage as SetupStage;
  }

  return defaultState.stage;
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
        stage: normalizedStage,
        requiresReboot: parsed.requiresReboot ?? defaultState.requiresReboot,
        message: sanitizeMessage(parsed.message),
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

    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[setup-store] Failed to persist setup state: ${detail}`);
    }

    return merged;
  }
}
