import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  ProviderModelsError,
  listProviderModels,
  resolveCustomProviderProtocol
} from "$lib/server/providers/customProtocol";
import type { DesktopProviderModelsResponse } from "$lib/shared/desktop";

export const POST: RequestHandler = async ({ request }) => {
  let providerId = "";
  let baseUrl: string | undefined;
  let apiKey: string | undefined;
  let protocolParam: string | undefined;
  let pathParam: string | undefined;
  try {
    const body = (await request.json()) as { providerId?: unknown; baseUrl?: unknown; apiKey?: unknown; protocol?: unknown; path?: unknown };
    providerId = String(body.providerId ?? "").trim();
    baseUrl = body.baseUrl ? String(body.baseUrl).trim() : undefined;
    apiKey = body.apiKey ? String(body.apiKey).trim() : undefined;
    protocolParam = body.protocol ? String(body.protocol).trim() : undefined;
    pathParam = body.path ? String(body.path).trim() : undefined;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  let finalBaseUrl = "";
  let finalApiKey = "";
  let finalProtocol = "";
  let finalPathParam = "";

  if (baseUrl !== undefined && apiKey !== undefined) {
    finalBaseUrl = baseUrl;
    finalApiKey = apiKey;
    finalProtocol = resolveCustomProviderProtocol(protocolParam);
    finalPathParam = pathParam ?? "";
  } else {
    if (!providerId) return json({ ok: false, error: "providerId is required when baseUrl or apiKey is not provided" }, { status: 400 });
    const provider = (getRuntime().getSettings().customProviders ?? []).find((row) => row.id === providerId);
    if (!provider) return json({ ok: false, error: "Provider not found" }, { status: 404 });
    finalBaseUrl = provider.baseUrl || "";
    finalApiKey = provider.apiKey || "";
    finalProtocol = resolveCustomProviderProtocol(provider.protocol);
    finalPathParam = provider.path || "";
  }

  if (!finalBaseUrl || !finalApiKey) {
    return json({ ok: false, error: "Provider is missing baseUrl or apiKey" }, { status: 400 });
  }
  try {
    const models = await listProviderModels({
      protocol: finalProtocol,
      baseUrl: finalBaseUrl,
      apiKey: finalApiKey,
      path: finalPathParam
    });
    const response: DesktopProviderModelsResponse = { ok: true, models };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProviderModelsError) {
      return json({ ok: false, error: error.message }, { status: error.status });
    }
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
