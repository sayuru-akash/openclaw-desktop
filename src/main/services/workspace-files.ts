import { access } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceEditableFileName, WorkspaceFilePayload } from "../../shared/types";

const LEGACY_BOOTSTRAP_FILE = "boostrap.md";
const LEGACY_AGENTS_FILE = "agents.md";
const LEGACY_HEARTBEAT_FILE = "heartbeat.md";

const ALLOWED_FILE_SET = new Set<WorkspaceEditableFileName>([
  "openclaw.json",
  "soul.md",
  "skills.md",
  "bootstrap.md",
  "AGENTS.md",
  "HEARTBEAT.md"
]);

export class WorkspaceFilesService {
  public async getFile(workspacePath: string, fileName: WorkspaceEditableFileName): Promise<WorkspaceFilePayload> {
    const rootPath = this.resolveWorkspacePath(workspacePath);
    const candidatePaths = this.resolveCandidatePaths(rootPath, fileName);

    for (const candidatePath of candidatePaths) {
      try {
        const content = await readFile(candidatePath, "utf8");
        return {
          fileName,
          path: candidatePath,
          exists: true,
          content,
          updatedAt: new Date().toISOString()
        };
      } catch (error) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return {
      fileName,
      path: candidatePaths[0],
      exists: false,
      content: "",
      updatedAt: new Date().toISOString()
    };
  }

  public async saveFile(
    workspacePath: string,
    fileName: WorkspaceEditableFileName,
    content: string
  ): Promise<WorkspaceFilePayload> {
    const rootPath = this.resolveWorkspacePath(workspacePath);
    await mkdir(rootPath, { recursive: true });

    const candidatePaths = this.resolveCandidatePaths(rootPath, fileName);
    const existingPath = await this.findFirstExistingPath(candidatePaths);
    const targetPath = existingPath || candidatePaths[0];

    await writeFile(targetPath, content, "utf8");

    return {
      fileName,
      path: targetPath,
      exists: true,
      content,
      updatedAt: new Date().toISOString()
    };
  }

  private resolveWorkspacePath(workspacePath: string): string {
    const normalized = workspacePath.trim();
    if (!normalized) {
      throw new Error("Workspace path is required before editing OpenClaw files.");
    }

    return path.resolve(normalized);
  }

  private resolveCandidatePaths(workspacePath: string, fileName: WorkspaceEditableFileName): string[] {
    if (!ALLOWED_FILE_SET.has(fileName)) {
      throw new Error(`Unsupported workspace file: ${fileName}`);
    }

    if (fileName === "bootstrap.md") {
      return [
        path.join(workspacePath, "bootstrap.md"),
        path.join(workspacePath, LEGACY_BOOTSTRAP_FILE)
      ];
    }

    if (fileName === "AGENTS.md") {
      return [
        path.join(workspacePath, "AGENTS.md"),
        path.join(workspacePath, LEGACY_AGENTS_FILE)
      ];
    }

    if (fileName === "HEARTBEAT.md") {
      return [
        path.join(workspacePath, "HEARTBEAT.md"),
        path.join(workspacePath, LEGACY_HEARTBEAT_FILE)
      ];
    }

    return [path.join(workspacePath, fileName)];
  }

  private async findFirstExistingPath(paths: string[]): Promise<string | null> {
    for (const currentPath of paths) {
      try {
        await access(currentPath);
        return currentPath;
      } catch (error) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return null;
  }

  private isNotFoundError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT");
  }
}
