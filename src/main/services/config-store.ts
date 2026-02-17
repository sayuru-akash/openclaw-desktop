import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../shared/types";

const defaultConfig: AppConfig = {
  profileName: "Default",
  workspacePath: "",
  autoStartGateway: true,
  updatedAt: new Date(0).toISOString()
};

export class ConfigStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "openclaw-desktop.json");
  }

  public async load(): Promise<AppConfig> {
    try {
      const payload = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(payload) as Partial<AppConfig>;
      return {
        profileName: parsed.profileName ?? defaultConfig.profileName,
        workspacePath: parsed.workspacePath ?? defaultConfig.workspacePath,
        autoStartGateway: parsed.autoStartGateway ?? defaultConfig.autoStartGateway,
        updatedAt: parsed.updatedAt ?? defaultConfig.updatedAt
      };
    } catch {
      return { ...defaultConfig };
    }
  }

  public async save(next: Partial<AppConfig>): Promise<AppConfig> {
    const current = await this.load();
    const merged: AppConfig = {
      ...current,
      ...next,
      updatedAt: new Date().toISOString()
    };

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");

    return merged;
  }
}
