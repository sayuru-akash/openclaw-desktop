import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { CommandResult } from "../../shared/types";

const GRACEFUL_KILL_GRACE_MS = 3000;

/**
 * On Windows, child.kill('SIGTERM') calls TerminateProcess which is a hard kill
 * with no chance for graceful shutdown. This helper uses taskkill without /F first
 * (which sends WM_CLOSE), then force-kills after a grace period if still alive.
 */
function killChildGracefully(child: ChildProcess, signal: NodeJS.Signals | number): void {
  if (process.platform !== "win32" || !child.pid) {
    child.kill(signal);
    return;
  }

  const pid = child.pid;
  execFile("taskkill.exe", ["/PID", String(pid)], (error) => {
    if (error) {
      // Graceful kill failed (process may not accept WM_CLOSE); force-kill
      child.kill("SIGKILL");
      return;
    }
    // Give the process a grace period to exit cleanly, then force-kill
    setTimeout(() => {
      try {
        process.kill(pid, 0); // throws if process already exited
        execFile("taskkill.exe", ["/F", "/PID", String(pid)], () => {});
      } catch {
        // Process already exited — nothing to do
      }
    }, GRACEFUL_KILL_GRACE_MS);
  });
}

interface RunCommandOptions {
  okExitCodes?: number[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  killSignal?: NodeJS.Signals | number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function runCommand(file: string, args: string[] = [], options: RunCommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const killSignal = options.killSignal ?? "SIGTERM";
    const useManualTimeout = process.platform === "win32";

    const child = execFile(file, args, {
      encoding: "utf8",
      cwd: options.cwd,
      env: options.env,
      // On Windows, the built-in timeout uses TerminateProcess (hard kill).
      // We handle timeout manually so we can use graceful shutdown instead.
      timeout: useManualTimeout ? 0 : timeoutMs,
      killSignal: useManualTimeout ? undefined : killSignal
    }, (error, stdout, stderr) => {
      if (manualTimeout) {
        clearTimeout(manualTimeout);
      }
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
          stderr: normalizedStderr || (error.killed || manualTimedOut
            ? `Command timed out after ${Math.round(timeoutMs / 1000)} seconds.`
            : error.message)
        });
        return;
      }

      resolve({ ok: true, code: 0, stdout: normalizedStdout, stderr: normalizedStderr });
    });

    let manualTimedOut = false;
    const manualTimeout = useManualTimeout
      ? setTimeout(() => {
          manualTimedOut = true;
          killChildGracefully(child, killSignal);
        }, timeoutMs)
      : null;
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
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const killSignal = options.killSignal ?? "SIGTERM";
    const child = spawn(file, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
      env: options.env
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      killChildGracefully(child, killSignal);
    }, timeoutMs);

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
      clearTimeout(timeout);
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
      clearTimeout(timeout);
      const normalizedCode = typeof code === "number" ? code : null;
      const ok = !timedOut && normalizedCode !== null ? okExitCodes.has(normalizedCode) : false;
      resolve({
        ok,
        code: normalizedCode,
        stdout,
        stderr: timedOut
          ? `${stderr}\nCommand timed out after ${Math.round(timeoutMs / 1000)} seconds.`.trim()
          : stderr
      });
    });
  });
}
