import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { isKnownProvider } from "$lib/server/settings";
import { updateSkillsConfig } from "$lib/server/settings/handlers/skills";
import { buildSkillSearchSettings } from "$lib/server/skills/searchSettings";
import type { DesktopSkillSearchConfig, DesktopSkillSearchConfigResponse } from "$lib/shared/desktop";

/**
 * Skill search configuration: one entity, saved on its own.
 *
 * The catalogue itself is served by the Skill Manager; this route only owns
 * the local/API search preference, which is why it cannot accidentally submit
 * the rest of the runtime settings object.
 */
function readConfig(): DesktopSkillSearchConfig {
  const settings = getRuntime().getSettings();
  const search = settings.skillSearch;
  const providers = settings.customProviders
    .filter((provider) => provider.enabled !== false)
    .filter((provider) => !isKnownProvider(provider.id))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      defaultModel: provider.defaultModel,
      models: provider.models.map((model) => model.id).filter(Boolean)
    }))
    .filter((provider) => provider.models.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    localEnabled: search.local.enabled === true,
    apiEnabled: search.api.enabled === true,
    apiProvider: search.api.provider ?? "",
    apiModel: search.api.model ?? "",
    maxTokens: Number(search.api.maxTokens ?? 400),
    temperature: Number(search.api.temperature ?? 0),
    timeoutMs: Number(search.api.timeoutMs ?? 8000),
    minConfidence: Number(search.api.minConfidence ?? 0.6),
    apiBaseUrl: search.api.baseUrl ?? "",
    apiPath: search.api.path ?? "",
    apiKeySet: Boolean(search.api.apiKey),
    providers
  };
}

export const GET: RequestHandler = () => {
  const response: DesktopSkillSearchConfigResponse = { ok: true, search: readConfig() };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as DesktopSkillSearchConfig;
    const runtime = getRuntime();
    const skillSearch = buildSkillSearchSettings(runtime.getSettings(), body);
    updateSkillsConfig(runtime, { skillSearch });
    const response: DesktopSkillSearchConfigResponse = { ok: true, search: readConfig() };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
};
