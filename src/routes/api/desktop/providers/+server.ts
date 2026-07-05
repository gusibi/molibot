import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopProvidersSummary } from "$lib/server/app/desktopProviders";
import { buildNewCustomProvider } from "$lib/server/app/desktopProviderSubmit";
import { buildProviderGlobalsPatch, buildProviderUpdatePatch } from "$lib/server/app/desktopProviderManage";
import {
  deleteCustomProvider,
  readCustomProvidersConfig,
  replaceCustomProviders,
  updateGlobalProviderSettings,
  upsertCustomProvider
} from "$lib/server/settings/handlers/customProviders";
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
    if (readCustomProvidersConfig(runtime).customProviders.some((provider) => provider.id === id)) {
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
    const { saved } = upsertCustomProvider(runtime, newProvider, { activateAsDefault: true, switchToCustomMode: true });
    const response: DesktopProviderSubmitResponse = { ok: true, providerId: saved.id };
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
    const shaped = buildProviderUpdatePatch(runtime.getSettings(), { ...body, id });
    replaceCustomProviders(runtime, shaped.customProviders);
    const response: DesktopProviderMutationResponse = {
      ok: true,
      summary: buildDesktopProvidersSummary(runtime.getSettings())
    };
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
    const shaped = buildProviderGlobalsPatch(runtime.getSettings(), body);
    updateGlobalProviderSettings(runtime, shaped);
    const response: DesktopProviderMutationResponse = {
      ok: true,
      summary: buildDesktopProvidersSummary(runtime.getSettings())
    };
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
    if (!readCustomProvidersConfig(runtime).customProviders.some((p) => p.id === id)) {
      return json({ ok: false, error: "Provider not found" }, { status: 404 });
    }
    deleteCustomProvider(runtime, id);
    const response: DesktopProviderMutationResponse = {
      ok: true,
      summary: buildDesktopProvidersSummary(runtime.getSettings())
    };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
