import { KNOWN_PROVIDER_LIST, type CustomProviderConfig, type RuntimeSettings } from "$lib/server/settings/schema";
import { getPiCatalogModels as getModels } from "$lib/server/providers/piRuntime.js";
import type {
  DesktopProviderModel,
  DesktopProviderModelRole,
  DesktopProviderModelTag,
  DesktopProviderItem,
  DesktopProviderMode,
  DesktopProviderProtocol,
  DesktopProvidersSummary
} from "$lib/shared/desktop";
import {
  sanitizeOptionalThinkingFormat,
  sanitizeOptionalThinkingSupport,
  sanitizeReasoningEffortMap
} from "$lib/server/settings/thinking";

const MODEL_TAGS = new Set<DesktopProviderModelTag>(["text", "vision", "audio_input", "stt", "tts", "tool"]);
const MODEL_ROLES = new Set<DesktopProviderModelRole>(["system", "user", "assistant", "tool", "developer"]);

function buildDesktopProviderModel(model: CustomProviderConfig["models"][number]): DesktopProviderModel {
  return {
    id: String(model.id ?? "").trim(),
    tags: (Array.isArray(model.tags) ? model.tags : []).filter((tag): tag is DesktopProviderModelTag => MODEL_TAGS.has(tag as DesktopProviderModelTag)),
    supportedRoles: (Array.isArray(model.supportedRoles) ? model.supportedRoles : []).filter((role): role is DesktopProviderModelRole => MODEL_ROLES.has(role as DesktopProviderModelRole)),
    contextWindow: typeof model.contextWindow === "number" && model.contextWindow > 0 ? model.contextWindow : undefined,
    enabled: model.enabled !== false,
    verification: { ...(model.verification ?? {}) }
  };
}

function coerceProtocol(value: unknown): DesktopProviderProtocol {
  return value === "anthropic" ? "anthropic" : "openai-compatible";
}

/**
 * Maps a custom provider config into a credential-safe Desktop view. The
 * `apiKey` (a provider secret) is dropped and replaced by the `hasApiKey`
 * boolean; per-model verification details and the reasoning-effort map are
 * omitted too — the Desktop providers list only needs identity, protocol,
 * endpoint, and aggregate model counts to let a user audit configuration.
 */
export function buildDesktopProviderItem(
  provider: CustomProviderConfig,
  defaultCustomProviderId: string
): DesktopProviderItem {
  const models = Array.isArray(provider.models) ? provider.models : [];
  return {
    id: provider.id,
    name: provider.name || provider.id,
    enabled: provider.enabled !== false,
    isDefault: provider.id === defaultCustomProviderId,
    protocol: coerceProtocol(provider.protocol),
    baseUrl: provider.baseUrl ?? "",
    hasApiKey: typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0,
    modelCount: models.length,
    defaultModel: provider.defaultModel ?? "",
    path: provider.path ?? "",
    supportsThinking: sanitizeOptionalThinkingSupport(provider.supportsThinking) ?? null,
    thinkingFormat: sanitizeOptionalThinkingFormat(provider.thinkingFormat) ?? null,
    reasoningEffortMap: sanitizeReasoningEffortMap(provider.reasoningEffortMap) ?? {},
    models: models.map(buildDesktopProviderModel)
  };
}

export function buildDesktopProvidersSummary(settings: RuntimeSettings): DesktopProvidersSummary {
  const providerMode: DesktopProviderMode = settings.providerMode === "custom" ? "custom" : "pi";
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  return {
    providerMode,
    piProvider: settings.piModelProvider ?? "",
    piModel: settings.piModelName ?? "",
    defaultCustomProviderId: settings.defaultCustomProviderId ?? "",
    builtinProviders: KNOWN_PROVIDER_LIST.map((provider) => ({
      id: provider,
      name: provider,
      models: getModels(provider).map((model) => model.id)
    })),
    customProviders: providers.map((provider) =>
      buildDesktopProviderItem(provider, settings.defaultCustomProviderId ?? "")
    )
  };
}
