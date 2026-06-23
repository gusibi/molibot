import { getModels, type Model } from "@mariozechner/pi-ai";
import { isKnownProvider, type RuntimeSettings, type CustomProviderConfig } from "$lib/server/settings/index.js";
import { resolveBuiltInProviderDefaultModel } from "$lib/server/settings/modelSwitch.js";
import {
  buildCustomProviderCompat,
  resolveCustomProviderReasoningSupport,
  resolveThinkingLevel
} from "$lib/server/providers/customThinking.js";
import {
  buildAnthropicBaseUrl,
  buildOpenAIBaseUrl,
  resolveCustomProviderProtocol
} from "$lib/server/providers/customProtocol.js";
import { resolveProviderApiKey } from "$lib/server/agent/identity/auth.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";

export interface ResolvedModelSelection {
  model: Model<any>;
  source: "pi" | "custom";
  providerId: string;
  modelId: string;
  configuredModel?: CustomProviderConfig["models"][number];
}

export interface ModelAttemptFailure {
  provider: string;
  model: string;
  baseUrl?: string;
  endpointUrl?: string;
  message: string;
  kind: "request_error" | "empty_response" | "missing_api_key";
}

export function resolvePiModel(settings: RuntimeSettings): Model<any> {
  const models = getModels(settings.piModelProvider);
  const preferredModelId = resolveBuiltInProviderDefaultModel(
    settings,
    settings.piModelProvider,
    settings.piModelName
  );
  const found = models.find((m) => m.id === preferredModelId);
  if (found) return found;
  if (models[0]) return models[0];
  throw new Error(
    `No models available for provider '${settings.piModelProvider}'`,
  );
}

export function parseModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const raw = key.trim();
  if (!raw) return null;
  const [mode, provider, ...rest] = raw.split("|");
  if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
  const model = rest.join("|").trim();
  if (!model) return null;
  return { mode, provider: provider.trim(), model };
}

export function resolvePiModelByKey(provider: string, modelId: string): Model<any> | null {
  const models = getModels(provider as any);
  const found = models.find((m) => m.id === modelId);
  return found ?? null;
}

export function isCustomProviderUsable(provider: CustomProviderConfig): boolean {
  return Boolean(provider.baseUrl?.trim() && provider.apiKey?.trim());
}

export function modelSupportsUseCase(
  model: Pick<CustomProviderConfig["models"][number], "tags"> | undefined,
  useCase: "text" | "vision"
): boolean {
  const tags = Array.isArray(model?.tags) ? model.tags : [];
  if (useCase === "vision") return tags.includes("vision");
  return tags.length === 0 || tags.includes("text");
}

export function pickCustomModelId(provider: CustomProviderConfig, useCase: "text" | "vision"): string {
  const rows = provider.models.filter((m) => Boolean(m.id?.trim()));
  if (rows.length === 0) return "";

  const byDefault = rows.find((m) => m.id === provider.defaultModel && modelSupportsUseCase(m, useCase));
  if (byDefault?.id) return byDefault.id;
  const matched = rows.find((m) => modelSupportsUseCase(m, useCase));
  return matched?.id ?? "";
}

export function getProviderModel(provider: CustomProviderConfig): string {
  const modelIds = provider.models.map((m) => m.id).filter(Boolean);
  const selected = provider.defaultModel?.trim();
  if (selected && modelIds.includes(selected)) return selected;
  return modelIds[0]?.trim() || "";
}

export function getSelectedCustomProvider(
  settings: RuntimeSettings,
  options: { includeBuiltIn?: boolean } = {}
): CustomProviderConfig | undefined {
  const includeBuiltIn = options.includeBuiltIn === true;
  const candidates = includeBuiltIn
    ? settings.customProviders.filter((p) => p.enabled !== false)
    : settings.customProviders.filter((p) => !isKnownProvider(p.id) && p.enabled !== false);
  if (candidates.length === 0) return undefined;
  return (
    candidates.find(
      (p) => p.id === settings.defaultCustomProviderId,
    ) ?? candidates[0]
  );
}

export function getCustomProviderById(settings: RuntimeSettings, providerId: string): CustomProviderConfig | undefined {
  return settings.customProviders.find((p) => p.id === providerId);
}

export function getCustomModelRoles(settings: RuntimeSettings): string[] {
  const routed = parseModelKey(settings.modelRouting.textModelKey);
  if (routed?.mode === "custom") {
    const provider = getCustomProviderById(settings, routed.provider);
    const model = provider?.models.find((m) => m.id === routed.model && modelSupportsUseCase(m, "text"));
    if (model?.supportedRoles?.length) return model.supportedRoles;
  }

  const selected = getSelectedCustomProvider(settings);
  if (!selected) return [];
  const modelId = getProviderModel(selected);
  const model = selected.models.find((m) => m.id === modelId && modelSupportsUseCase(m, "text"))
    ?? selected.models.find((m) => modelSupportsUseCase(m, "text"));
  return model?.supportedRoles ?? [];
}

export function buildAgentSessionId(
  channel: string,
  chatId: string,
  sessionId: string,
  useCase: "text" | "vision",
  selection: ResolvedModelSelection
): string {
  return [channel, chatId, sessionId, useCase, selection.providerId, selection.modelId].join(":");
}

export function sameModelSelection(a: ResolvedModelSelection, b: ResolvedModelSelection): boolean {
  return a.source === b.source && a.providerId === b.providerId && a.modelId === b.modelId;
}

export function resolveCustomModel(selected: CustomProviderConfig, modelId: string): Model<any> {
  const protocol = resolveCustomProviderProtocol(selected.protocol);
  const computedBaseUrl = protocol === "anthropic"
    ? buildAnthropicBaseUrl(selected.baseUrl, selected.path)
    : buildOpenAIBaseUrl(selected.baseUrl, selected.path);
  const configuredModel = selected.models.find((m) => m.id === modelId);
  const supportsVerifiedVision = Boolean(
    configuredModel?.tags?.includes("vision") &&
    configuredModel?.verification?.vision === "passed"
  );
  return {
    id: modelId,
    name: selected.name || modelId,
    api: protocol === "anthropic" ? "anthropic-messages" : "openai-completions",
    provider: selected.id || "custom-provider",
    baseUrl: computedBaseUrl,
    reasoning: resolveCustomProviderReasoningSupport(selected),
    input: supportsVerifiedVision ? ["text", "image"] : ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: configuredModel?.contextWindow || 200000,
    maxTokens: 8192,
    compat: protocol === "anthropic" ? undefined : buildCustomProviderCompat(selected)
  };
}

/**
 * Layer an agent's per-route model overrides on top of the global routing.
 *
 * Resolves which agent owns the (channel, botId) pair via the channel instance's
 * `agentId`, then overrides only the text/vision/stt keys the agent has set. Every
 * other route (tts, compaction, subagent levels) is left untouched so it keeps
 * following global. Returns the original `settings` reference unchanged when there
 * is no agent or no override — callers can treat this as a cheap pass-through.
 */
export function applyAgentModelRoutingOverride(
  settings: RuntimeSettings,
  channel: string,
  botId: string
): RuntimeSettings {
  const instances = settings.channels?.[channel]?.instances ?? [];
  const agentId = (instances.find((instance) => instance.id === botId)?.agentId ?? "").trim();
  if (!agentId) return settings;
  const override = settings.agents.find((agent) => agent.id === agentId)?.modelRouting;
  if (!override) return settings;

  const merged = { ...settings.modelRouting };
  if (override.textModelKey) merged.textModelKey = override.textModelKey;
  if (override.visionModelKey) merged.visionModelKey = override.visionModelKey;
  if (override.sttModelKey) merged.sttModelKey = override.sttModelKey;
  return { ...settings, modelRouting: merged };
}

export function resolveModelSelection(
  settings: RuntimeSettings,
  useCase: "text" | "vision" = "text"
): ResolvedModelSelection {
  const routedKey = useCase === "vision"
    ? settings.modelRouting.visionModelKey
    : settings.modelRouting.textModelKey;
  const routed = parseModelKey(routedKey);
  if (routed) {
    if (routed.mode === "pi") {
      const pi = resolvePiModelByKey(routed.provider, routed.model);
      if (pi) {
        return {
          model: pi,
          source: "pi",
          providerId: routed.provider,
          modelId: routed.model
        };
      }
    } else {
      if (isKnownProvider(routed.provider)) {
        const pi = resolvePiModelByKey(routed.provider, routed.model);
        if (pi) {
          return {
            model: pi,
            source: "pi",
            providerId: routed.provider,
            modelId: routed.model
          };
        }
      }
      const provider = getCustomProviderById(settings, routed.provider);
      const configuredModel = provider?.models.find((m) => m.id === routed.model);
      if (
        provider &&
        provider.enabled !== false &&
        isCustomProviderUsable(provider) &&
        routed.model &&
        modelSupportsUseCase(configuredModel, useCase)
      ) {
        return {
          model: resolveCustomModel(provider, routed.model),
          source: "custom",
          providerId: provider.id,
          modelId: routed.model,
          configuredModel
        };
      }
    }
  }

  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    const modelId = selected ? pickCustomModelId(selected, useCase) : "";
    if (selected && isCustomProviderUsable(selected) && modelId) {
      return {
        model: resolveCustomModel(selected, modelId),
        source: "custom",
        providerId: selected.id,
        modelId,
        configuredModel: selected.models.find((m) => m.id === modelId)
      };
    }
  }

  for (const provider of settings.customProviders) {
    if (provider.enabled === false) continue;
    if (!isCustomProviderUsable(provider)) continue;
    const modelId = pickCustomModelId(provider, useCase);
    if (!modelId) continue;
    return {
      model: resolveCustomModel(provider, modelId),
      source: "custom",
      providerId: provider.id,
      modelId,
      configuredModel: provider.models.find((m) => m.id === modelId)
    };
  }

  const pi = resolvePiModel(settings);
  return {
    model: pi,
    source: "pi",
    providerId: settings.piModelProvider,
    modelId: pi.id
  };
}

export function resolveModel(settings: RuntimeSettings, useCase: "text" | "vision" = "text"): Model<any> {
  return resolveModelSelection(settings, useCase).model;
}

/**
 * Resolve the model used for session context compaction (summarization).
 *
 * When `modelRouting.compactionModelKey` is set it takes priority — treated as a
 * text-capable route — so summaries can run on a cheaper/faster model than the
 * primary conversation. If it is empty or no longer resolves to a usable model,
 * this falls back to the primary text selection.
 */
export function resolveCompactionSelection(settings: RuntimeSettings): ResolvedModelSelection {
  const key = settings.modelRouting.compactionModelKey?.trim();
  if (key) {
    return resolveModelSelection(
      { ...settings, modelRouting: { ...settings.modelRouting, textModelKey: key } },
      "text"
    );
  }
  return resolveModelSelection(settings, "text");
}

export function appendEndpointPath(baseUrl: string, endpointPath: string): string {
  return `${baseUrl.replace(/\/$/, "")}${endpointPath}`;
}

export function modelEndpointUrl(api: string, baseUrl: string): string | undefined {
  if (api === "anthropic-messages") {
    return appendEndpointPath(baseUrl, "/v1/messages");
  }
  if (api === "openai-completions") {
    return appendEndpointPath(baseUrl, "/chat/completions");
  }
  return undefined;
}

export function toModelAttemptFailure(
  selection: ResolvedModelSelection,
  message: string,
  kind: ModelAttemptFailure["kind"]
): ModelAttemptFailure {
  const redactedBaseUrl = selection.model.baseUrl ? redactBaseUrl(selection.model.baseUrl) : undefined;
  return {
    provider: selection.model.provider,
    model: selection.model.id,
    baseUrl: redactedBaseUrl,
    endpointUrl: redactedBaseUrl ? modelEndpointUrl(selection.model.api, redactedBaseUrl) : undefined,
    message,
    kind
  };
}

export function formatModelAttemptFailure(failure: ModelAttemptFailure): string {
  return [
    `provider=${failure.provider}`,
    `model=${failure.model}`,
    failure.baseUrl ? `baseUrl=${failure.baseUrl}` : null,
    failure.endpointUrl ? `endpoint=${failure.endpointUrl}` : null,
    `type=${failure.kind}`,
    `error=${failure.message}`
  ].filter(Boolean).join(", ");
}

export function buildModelFallbackSelections(
  settings: RuntimeSettings,
  primary: ResolvedModelSelection,
  useCase: "text" | "vision"
): ResolvedModelSelection[] {
  const seen = new Set<string>();
  const pushUnique = (rows: ResolvedModelSelection[], row: ResolvedModelSelection): void => {
    const key = `${row.source}|${row.providerId}|${row.modelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  const rows: ResolvedModelSelection[] = [];
  pushUnique(rows, primary);
  const fallbackMode = settings.modelFallback?.mode ?? "same-provider";
  if (fallbackMode === "off") {
    return rows;
  }

  const sameProviderAlternatives = settings.customProviders
    .filter((provider) => provider.enabled !== false && isCustomProviderUsable(provider))
    .filter((provider) => provider.id === primary.providerId)
    .flatMap((provider) =>
      provider.models
        .filter((model) => Boolean(model.id?.trim()))
        .filter((model) => modelSupportsUseCase(model, useCase))
        .filter((model) => model.id !== primary.modelId)
        .map((model) => ({
          model: resolveCustomModel(provider, model.id),
          source: "custom" as const,
          providerId: provider.id,
          modelId: model.id,
          configuredModel: provider.models.find((row) => row.id === model.id)
        }))
    );

  if (fallbackMode === "same-provider") {
    for (const row of sameProviderAlternatives) {
      pushUnique(rows, row);
    }
    return rows;
  }

  const differentProviderCustom: ResolvedModelSelection[] = [];
  for (const provider of settings.customProviders) {
    if (provider.enabled === false || !isCustomProviderUsable(provider) || provider.id === primary.providerId) {
      continue;
    }
    const modelId = pickCustomModelId(provider, useCase);
    if (!modelId) continue;
    differentProviderCustom.push({
      model: resolveCustomModel(provider, modelId),
      source: "custom",
      providerId: provider.id,
      modelId,
      configuredModel: provider.models.find((model) => model.id === modelId)
    });
  }

  for (const row of differentProviderCustom) {
    pushUnique(rows, row);
  }

  for (const row of sameProviderAlternatives) {
    pushUnique(rows, row);
  }

  const piSelection = resolveModelSelection(
    {
      ...settings,
      providerMode: "pi",
      modelRouting: {
        ...settings.modelRouting,
        textModelKey: `pi|${settings.piModelProvider}|${
          resolveBuiltInProviderDefaultModel(settings, settings.piModelProvider, settings.piModelName)
        }`,
        visionModelKey: `pi|${settings.piModelProvider}|${
          resolveBuiltInProviderDefaultModel(settings, settings.piModelProvider, settings.piModelName)
        }`
      }
    },
    useCase
  );
  pushUnique(rows, piSelection);

  return rows;
}

export function redactBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.replace(/\/\/([^/@]+)@/, "//***@");
}

export function recordModelFailure(
  tracker: ModelErrorTracker,
  input: {
    channel: string;
    botId: string;
    chatId: string;
    sessionId: string;
    runId: string;
    route: "text" | "vision" | "stt" | "tts";
    selection: ResolvedModelSelection;
    failure: ModelAttemptFailure;
    candidateIndex: number;
    recovered: boolean;
    fallbackUsed: boolean;
    finalSelection?: ResolvedModelSelection;
  }
): void {
  tracker.record({
    source: "runner",
    channel: input.channel,
    botId: input.botId,
    chatId: input.chatId,
    sessionId: input.sessionId,
    runId: input.runId,
    provider: input.failure.provider,
    model: input.failure.model,
    api: input.selection.model.api,
    route: input.route,
    kind: input.failure.kind,
    message: input.failure.message,
    baseUrl: input.failure.baseUrl,
    endpointUrl: input.failure.endpointUrl,
    candidateIndex: input.candidateIndex,
    recovered: input.recovered,
    fallbackUsed: input.fallbackUsed,
    finalProvider: input.finalSelection?.model.provider,
    finalModel: input.finalSelection?.model.id
  });
}

export function keyFingerprint(key: string | undefined): string {
  if (!key) return "none";
  if (key.length <= 8) return `len=${key.length}`;
  return `${key.slice(0, 4)}...${key.slice(-2)}(len=${key.length})`;
}

export async function resolveApiKeyForModel(
  model: Model<any>,
  settings: RuntimeSettings,
): Promise<string | undefined> {
  const mapped = settings.customProviders.find((p) => p.id === model.provider);
  if (mapped) {
    return mapped.apiKey?.trim() || undefined;
  }

  return resolveProviderApiKey(model.provider);
}
