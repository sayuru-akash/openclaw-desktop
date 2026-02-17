import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SetupState } from "../../shared/types";

const defaultState: SetupState = {
  stage: "idle",
  requiresReboot: false,
  resumeOnLogin: false,
  message: "Setup has not started yet.",
  updatedAt: new Date(0).toISOString()
};

export class SetupStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "setup-state.json");
  }

  public async load(): Promise<SetupState> {
    try {
      const payload = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(payload) as Partial<SetupState>;

      return {
        stage: parsed.stage ?? defaultState.stage,
        requiresReboot: parsed.requiresReboot ?? defaultState.requiresReboot,
        resumeOnLogin: parsed.resumeOnLogin ?? defaultState.resumeOnLogin,
        message: parsed.message ?? defaultState.message,
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
