import { execFile, spawn } from "node:child_process";
import type { CommandResult } from "../../shared/types";

interface RunCommandOptions {
  okExitCodes?: number[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function runCommand(file: string, args: string[] = [], options: RunCommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", cwd: options.cwd, env: options.env }, (error, stdout, stderr) => {
      const normalizedStdout = stdout ?? "";
      const normalizedStderr = stderr ?? "";
      const okExitCodes = new Set([0, ...(options.okExitCodes ?? [])]);

      if (error) {
        const code = typeof error.code === "number" ? error.code : null;
        const isExpectedCode = code !== null && okExitCodes.has(code);

        if (isExpectedCode) {
          resolve({
            ok: true,
            code,
            stdout: normalizedStdout,
            stderr: normalizedStderr
          });
          return;
        }

        resolve({
          ok: false,
          code,
          stdout: normalizedStdout,
          stderr: normalizedStderr || error.message
        });
        return;
      }

      resolve({ ok: true, code: 0, stdout: normalizedStdout, stderr: normalizedStderr });
    });
  });
}

interface RunCommandStreamingOptions extends RunCommandOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export function runCommandStreaming(
  file: string,
  args: string[] = [],
  options: RunCommandStreamingOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const okExitCodes = new Set([0, ...(options.okExitCodes ?? [])]);
    const child = spawn(file, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
      env: options.env
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      options.onStderr?.(text);
    });

    child.on("error", (error) => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: stderr || error.message
      });
    });

    child.on("close", (code) => {
      if (resolved) {
        return;
      }

      resolved = true;
      const normalizedCode = typeof code === "number" ? code : null;
      const ok = normalizedCode !== null ? okExitCodes.has(normalizedCode) : false;
      resolve({
        ok,
        code: normalizedCode,
        stdout,
        stderr
      });
    });
  });
}
