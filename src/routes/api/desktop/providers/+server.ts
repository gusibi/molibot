import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopProvidersSummary } from "$lib/server/app/desktopProviders";
import { buildNewCustomProvider } from "$lib/server/app/desktopProviderSubmit";
import {
  buildProviderDeletePatch,
  buildProviderGlobalsPatch,
  buildProviderUpdatePatch
} from "$lib/server/app/desktopProviderManage";
import type {
  DesktopProviderGlobalsRequest,
  DesktopProviderMutationResponse,
  DesktopProvidersResponse,
  DesktopProviderCreateRequest,
  DesktopProviderSubmitResponse,
  DesktopProviderUpdateRequest
} from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopProvidersResponse = {
    ok: true,
    summary: buildDesktopProvidersSummary(runtime.getSettings())
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

/**
 * POST — Onboarding provider submit. Creates a new custom provider and makes
 * it the default, switching providerMode to "custom". The API key is persisted
 * in the server config and never returned in the response.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopProviderCreateRequest;
  try {
    body = (await request.json()) as DesktopProviderCreateRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" } satisfies DesktopProviderSubmitResponse, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const baseUrl = String(body.baseUrl ?? "").trim();
  const apiKey = String(body.apiKey ?? "").trim();

  if (!id || !name || !baseUrl || !apiKey) {
    return json(
      { ok: false, error: "id, name, baseUrl and apiKey are required" } satisfies DesktopProviderSubmitResponse,
      { status: 400 }
    );
  }

  try {
    const runtime = getRuntime();
    const settings = runtime.getSettings();
    const existing = Array.isArray(settings.customProviders) ? settings.customProviders : [];
    if (existing.some((provider) => provider.id === id)) {
      return json({ ok: false, error: "Provider id already exists" } satisfies DesktopProviderSubmitResponse, { status: 409 });
    }
    const newProvider = buildNewCustomProvider({
      id,
      name,
      enabled: body.enabled !== false,
      protocol: body.protocol,
      baseUrl,
      apiKey,
      models: Array.isArray(body.models) ? body.models : [],
      defaultModel: String(body.defaultModel ?? "").trim(),
      path: String(body.path ?? "").trim(),
      supportsThinking: body.supportsThinking,
      thinkingFormat: body.thinkingFormat,
      reasoningEffortMap: body.reasoningEffortMap ?? {}
    });

    runtime.updateSettings({
      customProviders: [...existing, newProvider],
      providerMode: "custom",
      defaultCustomProviderId: newProvider.id
    });

    const response: DesktopProviderSubmitResponse = { ok: true, providerId: newProvider.id };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response: DesktopProviderSubmitResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    return json(response, { status: 500 });
  }
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopProviderUpdateRequest;
  try {
    body = (await request.json()) as DesktopProviderUpdateRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
  try {
    const runtime = getRuntime();
    const patch = buildProviderUpdatePatch(runtime.getSettings(), { ...body, id });
    const updated = runtime.updateSettings(patch);
    const response: DesktopProviderMutationResponse = { ok: true, summary: buildDesktopProvidersSummary(updated) };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: DesktopProviderGlobalsRequest;
  try {
    body = (await request.json()) as DesktopProviderGlobalsRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const runtime = getRuntime();
    const updated = runtime.updateSettings(buildProviderGlobalsPatch(runtime.getSettings(), body));
    const response: DesktopProviderMutationResponse = { ok: true, summary: buildDesktopProvidersSummary(updated) };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
  try {
    const runtime = getRuntime();
    const updated = runtime.updateSettings(buildProviderDeletePatch(runtime.getSettings(), id));
    const response: DesktopProviderMutationResponse = { ok: true, summary: buildDesktopProvidersSummary(updated) };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
