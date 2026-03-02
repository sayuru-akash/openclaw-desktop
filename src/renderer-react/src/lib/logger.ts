type LogLevel = "info" | "warn" | "error";

interface LogPayload {
  area: string;
  event: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

function write(level: LogLevel, payload: LogPayload): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    ...payload
  };

  if (level === "error") {
    console.error("[renderer]", entry);
    return;
  }
  if (level === "warn") {
    console.warn("[renderer]", entry);
    return;
  }
  console.info("[renderer]", entry);
}

export function createRequestId(prefix = "rq"): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

export function logInfo(payload: LogPayload): void {
  write("info", payload);
}

export function logWarn(payload: LogPayload): void {
  write("warn", payload);
}

export function logError(payload: LogPayload): void {
  write("error", payload);
}
