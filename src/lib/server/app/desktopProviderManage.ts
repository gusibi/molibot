import type { CustomProviderConfig, ProviderModelConfig, RuntimeSettings } from "$lib/server/settings/schema";
import type {
  DesktopProviderGlobalsRequest,
  DesktopProviderModel,
  DesktopProviderUpdateRequest
} from "$lib/shared/desktop";
import {
  defaultPathForProtocol,
  normalizeProviderBaseUrl,
  resolveCustomProviderProtocol
} from "$lib/server/providers/customProtocol";
import {
  sanitizeOptionalThinkingFormat,
  sanitizeOptionalThinkingSupport,
  sanitizeReasoningEffortMap
} from "$lib/server/settings/thinking";

function normalizeModel(model: DesktopProviderModel): ProviderModelConfig | null {
  const id = String(model.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    tags: Array.isArray(model.tags) && model.tags.length > 0 ? [...model.tags] : ["text"],
    supportedRoles: Array.isArray(model.supportedRoles) && model.supportedRoles.length > 0
      ? [...model.supportedRoles]
      : ["system", "user", "assistant", "tool"],
    contextWindow: typeof model.contextWindow === "number" && model.contextWindow > 0
      ? Math.floor(model.contextWindow)
      : undefined,
    enabled: model.enabled !== false,
    verification: { ...(model.verification ?? {}) }
  };
}

export function buildUpdatedDesktopProvider(
  current: CustomProviderConfig,
  request: DesktopProviderUpdateRequest
): CustomProviderConfig {
  const protocol = resolveCustomProviderProtocol(request.protocol);
  const models = (Array.isArray(request.models) ? request.models : [])
    .map(normalizeModel)
    .filter((model): model is ProviderModelConfig => model !== null);
  const requestedDefault = String(request.defaultModel ?? "").trim();
  const defaultModel = models.some((model) => model.id === requestedDefault)
    ? requestedDefault
    : models.find((model) => model.enabled)?.id ?? models[0]?.id ?? "";
  const replacementKey = String(request.apiKey ?? "").trim();
  return {
    id: current.id,
    name: String(request.name ?? "").trim() || current.id,
    enabled: request.enabled !== false,
    protocol,
    baseUrl: normalizeProviderBaseUrl(String(request.baseUrl ?? "")),
    apiKey: request.clearApiKey === true ? "" : replacementKey || current.apiKey,
    models,
    defaultModel,
    path: String(request.path ?? "").trim() || defaultPathForProtocol(protocol),
    supportsThinking: sanitizeOptionalThinkingSupport(request.supportsThinking),
    thinkingFormat: sanitizeOptionalThinkingFormat(request.thinkingFormat),
    reasoningEffortMap: sanitizeReasoningEffortMap(request.reasoningEffortMap)
  };
}

export function buildProviderUpdatePatch(
  settings: RuntimeSettings,
  request: DesktopProviderUpdateRequest
): Pick<RuntimeSettings, "customProviders" | "defaultCustomProviderId"> {
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  const index = providers.findIndex((provider) => provider.id === request.id);
  if (index < 0) throw new Error("Provider not found");
  const updated = buildUpdatedDesktopProvider(providers[index], request);
  const customProviders = providers.map((provider, providerIndex) => providerIndex === index ? updated : provider);
  const enabledCustom = customProviders.filter((provider) => provider.enabled !== false);
  const defaultCustomProviderId = enabledCustom.some((provider) => provider.id === settings.defaultCustomProviderId)
    ? settings.defaultCustomProviderId
    : enabledCustom[0]?.id ?? "";
  return { customProviders, defaultCustomProviderId };
}

export function buildProviderDeletePatch(
  settings: RuntimeSettings,
  providerId: string
): Pick<RuntimeSettings, "customProviders" | "defaultCustomProviderId"> {
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  if (!providers.some((provider) => provider.id === providerId)) throw new Error("Provider not found");
  const customProviders = providers.filter((provider) => provider.id !== providerId);
  const defaultCustomProviderId = customProviders.some((provider) => provider.enabled !== false && provider.id === settings.defaultCustomProviderId)
    ? settings.defaultCustomProviderId
    : customProviders.find((provider) => provider.enabled !== false)?.id ?? "";
  return { customProviders, defaultCustomProviderId };
}

export function buildProviderGlobalsPatch(
  settings: RuntimeSettings,
  request: DesktopProviderGlobalsRequest
): Pick<RuntimeSettings, "providerMode" | "piModelProvider" | "piModelName" | "defaultCustomProviderId"> {
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  const requestedDefault = String(request.defaultCustomProviderId ?? "").trim();
  const defaultCustomProviderId = providers.some((provider) => provider.id === requestedDefault && provider.enabled !== false)
    ? requestedDefault
    : providers.find((provider) => provider.enabled !== false)?.id ?? "";
  return {
    providerMode: request.providerMode === "custom" ? "custom" : "pi",
    piModelProvider: String(request.piProvider ?? "").trim(),
    piModelName: String(request.piModel ?? "").trim(),
    defaultCustomProviderId
  };
}
