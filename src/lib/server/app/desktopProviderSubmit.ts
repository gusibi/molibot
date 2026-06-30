import type { CustomProviderConfig } from "$lib/server/settings/schema";
import type { DesktopProviderCreateRequest } from "$lib/shared/desktop";
import { buildUpdatedDesktopProvider } from "$lib/server/app/desktopProviderManage";

/**
 * Builds a minimal custom provider config from an onboarding submit request.
 * Fields are assigned one-by-one (never spread) to enforce the §11 credential
 * boundary: no unexpected source field can leak through.
 *
 * The generated id uses a `desktop-` prefix + timestamp so it won't collide
 * with existing user-created providers.
 */
export function buildNewCustomProvider(req: DesktopProviderCreateRequest): CustomProviderConfig {
  const id = String(req.id ?? "").trim();
  const seed: CustomProviderConfig = {
    id,
    name: id,
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    models: [],
    defaultModel: "",
    path: "/v1/chat/completions"
  };
  return buildUpdatedDesktopProvider(seed, {
    id,
    name: req.name,
    enabled: req.enabled,
    protocol: req.protocol,
    baseUrl: req.baseUrl,
    apiKey: req.apiKey,
    models: req.models,
    defaultModel: req.defaultModel,
    path: req.path,
    supportsThinking: req.supportsThinking,
    thinkingFormat: req.thinkingFormat,
    reasoningEffortMap: req.reasoningEffortMap
  });
}
