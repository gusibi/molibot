import type { DesktopSkillSearchConfigUpdate } from "$lib/shared/desktop.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

/**
 * Entity-level Skill search settings.
 *
 * The Provider and model are validated against the enabled custom Providers,
 * and every server-owned field (endpoint, key, path) is preserved. Saving this
 * must never submit the whole runtime settings object.
 */
export function buildSkillSearchSettings(
  settings: RuntimeSettings,
  input: DesktopSkillSearchConfigUpdate
): RuntimeSettings["skillSearch"] {
  const provider = input.apiProvider.trim();
  const model = input.apiModel.trim();
  if (input.apiEnabled) {
    const configured = settings.customProviders.find(
      (item) => item.id === provider && item.enabled !== false && item.models.some((candidate) => candidate.id === model)
    );
    if (!configured) throw new Error("Select an enabled Provider and model");
  }
  return {
    local: { enabled: input.localEnabled },
    api: {
      ...settings.skillSearch.api,
      enabled: input.apiEnabled,
      provider,
      model,
      maxTokens: Math.min(4096, Math.max(128, Number(input.maxTokens) || 400)),
      temperature: Math.min(1, Math.max(0, Number(input.temperature) || 0)),
      timeoutMs: Math.min(60000, Math.max(1000, Number(input.timeoutMs) || 8000)),
      minConfidence: Math.min(1, Math.max(0, Number(input.minConfidence) || 0.6))
    }
  };
}
