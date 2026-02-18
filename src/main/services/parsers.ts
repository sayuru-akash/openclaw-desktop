import type { ChannelStatusItem, CommandResult, ManagedChannel } from "../../shared/types";

export interface InferredModelStatus {
  provider: string;
  model: string;
  availableProviders: string[];
  detail: string;
}

export function parseWindowsBuildFromRelease(release: string): number | null {
  const match = String(release).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  const build = Number.parseInt(match[3], 10);
  return Number.isFinite(build) ? build : null;
}

export function isWindowsBuildSupported(build: number | null): boolean {
  if (build === null) {
    return false;
  }

  // Win10 2004 (19041) and later have the modern WSL install flow we rely on.
  return build >= 19041;
}

export function isGatewayRunningOutput(output: string): boolean {
  return /running|active|ok/i.test(output);
}

export function isScheduledTaskMissing(result: CommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return output.includes("cannot find the file specified") || output.includes("cannot find the task");
}

export function inferChannelStatusFromPayload(
  channel: ManagedChannel,
  payload: unknown,
  rawText: string
): ChannelStatusItem {
  const blob = `${typeof payload === "string" ? payload : JSON.stringify(payload)} ${rawText}`.toLowerCase();
  const configured = !/(not configured|no account|missing|not logged|unknown channel|disabled)/i.test(blob);
  const connected = configured && /(connected|active|running|authenticated|online|ready|ok)/i.test(blob)
    && !/(disconnected|offline|not connected|failed|error|stopped)/i.test(blob);
  const summary = connected ? "Connected" : configured ? "Configured" : "Not configured";
  const detail = extractStatusDetail(payload, rawText);

  return {
    channel,
    configured,
    connected,
    summary,
    detail
  };
}

export function extractStatusDetail(payload: unknown, rawText: string): string {
  if (payload && typeof payload === "object") {
    const value = findFirstStringValue(payload, ["message", "status", "detail", "state", "reason"]);
    if (value) {
      return value;
    }
  }

  const line = rawText
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);

  return line || "No extra detail.";
}

export function inferModelStatusFromPayload(payload: unknown): InferredModelStatus {
  const provider = findFirstStringValue(payload, [
    "provider",
    "activeProvider",
    "defaultProvider",
    "selectedProvider"
  ]);
  const model = findFirstStringValue(payload, [
    "model",
    "activeModel",
    "defaultModel",
    "selectedModel",
    "modelId",
    "id"
  ]);
  const availableProviders = collectProviders(payload);

  return {
    provider: provider || "",
    model: model || "",
    availableProviders,
    detail: provider && model ? `Using ${provider} / ${model}` : "Model is not configured yet."
  };
}

function collectProviders(payload: unknown): string[] {
  const providers = new Set<string>();
  walkPayload(payload, (node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    const rawProvider = record.provider;
    if (typeof rawProvider === "string" && rawProvider.trim()) {
      providers.add(rawProvider.trim());
    }
  });

  return [...providers].sort((left, right) => left.localeCompare(right));
}

function findFirstStringValue(payload: unknown, keys: string[]): string {
  let found = "";
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  walkPayload(payload, (node) => {
    if (found || !node || typeof node !== "object") {
      return;
    }

    const entries = Object.entries(node as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (!wanted.has(key.toLowerCase())) {
        continue;
      }
      if (typeof value === "string" && value.trim()) {
        found = value.trim();
        return;
      }
    }
  });

  return found;
}

function walkPayload(payload: unknown, visitor: (node: unknown) => void): void {
  const stack: unknown[] = [payload];
  const seen = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined || seen.has(current)) {
      continue;
    }

    seen.add(current);
    visitor(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    if (typeof current === "object") {
      for (const value of Object.values(current as Record<string, unknown>)) {
        stack.push(value);
      }
    }
  }
}

