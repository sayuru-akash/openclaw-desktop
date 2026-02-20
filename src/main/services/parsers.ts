import type { ChannelStatusItem, CommandResult, ManagedChannel } from "../../shared/types";

export interface InferredModelStatus {
  provider: string;
  model: string;
  availableProviders: string[];
  modelsByProvider: Record<string, string[]>;
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
  const modelsByProvider = collectProviderModels(payload);

  return {
    provider: provider || "",
    model: model || "",
    availableProviders,
    modelsByProvider,
    detail: provider && model ? `Using ${provider} / ${model}` : "Model is not configured yet."
  };
}

function collectProviders(payload: unknown): string[] {
  const providers = new Set<string>();
  const register = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) {
      return;
    }
    providers.add(value.trim());
  };

  walkPayload(payload, (node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    register(record.provider);
    register(record.providerId);
    register(record.providerKey);

    const providersArray = Array.isArray(record.providers) ? record.providers : [];
    for (const entry of providersArray) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const providerRecord = entry as Record<string, unknown>;
      register(providerRecord.provider);
      register(providerRecord.providerId);
      register(providerRecord.providerKey);
      register(providerRecord.id);
      register(providerRecord.name);
    }
  });

  return [...providers].sort((left, right) => left.localeCompare(right));
}

function collectProviderModels(payload: unknown): Record<string, string[]> {
  const catalog = new Map<string, Set<string>>();

  const register = (providerRaw: unknown, modelRaw: unknown) => {
    if (typeof providerRaw !== "string" || !providerRaw.trim()) {
      return;
    }
    if (typeof modelRaw !== "string" || !modelRaw.trim()) {
      return;
    }

    const provider = providerRaw.trim();
    const model = modelRaw.trim();
    if (!catalog.has(provider)) {
      catalog.set(provider, new Set<string>());
    }
    catalog.get(provider)?.add(model);
  };

  const registerFromModelsArray = (providerRaw: unknown, modelsValue: unknown) => {
    if (!Array.isArray(modelsValue)) {
      return;
    }

    for (const item of modelsValue) {
      if (typeof item === "string") {
        register(providerRaw, item);
        continue;
      }

      if (!item || typeof item !== "object") {
        continue;
      }

      const modelObject = item as Record<string, unknown>;
      register(providerRaw, modelObject.model);
      register(providerRaw, modelObject.modelId);
      register(providerRaw, modelObject.id);
      register(providerRaw, modelObject.name);
    }
  };

  walkPayload(payload, (node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    const providerRaw = typeof record.provider === "string"
      ? record.provider
      : typeof record.providerId === "string"
        ? record.providerId
        : typeof record.providerKey === "string"
          ? record.providerKey
          : "";

    if (providerRaw) {
      register(providerRaw, record.model);
      register(providerRaw, record.modelId);
      register(providerRaw, record.selectedModel);
      register(providerRaw, record.defaultModel);
      registerFromModelsArray(providerRaw, record.models);
    }

    const providersArray = Array.isArray(record.providers) ? record.providers : [];
    for (const entry of providersArray) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const providerRecord = entry as Record<string, unknown>;
      const nestedProvider = providerRecord.provider
        ?? providerRecord.providerId
        ?? providerRecord.providerKey
        ?? providerRecord.id
        ?? providerRecord.name;
      register(nestedProvider, providerRecord.model);
      register(nestedProvider, providerRecord.modelId);
      register(nestedProvider, providerRecord.selectedModel);
      register(nestedProvider, providerRecord.defaultModel);
      registerFromModelsArray(nestedProvider, providerRecord.models);
    }
  });

  const result: Record<string, string[]> = {};
  for (const [provider, models] of catalog.entries()) {
    result[provider] = [...models].sort((left, right) => left.localeCompare(right));
  }
  return result;
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
