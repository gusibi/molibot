import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  buildAnthropicBaseUrl,
  buildAnthropicCompatibleHeaders,
  buildOpenAIBaseUrl,
  buildOpenAICompatibleHeaders,
  resolveCustomProviderProtocol
} from "$lib/server/providers/customProtocol";
import type { DesktopProviderModelsResponse } from "$lib/shared/desktop";

function parseModelIds(rawBody: unknown): string[] {
  const body = rawBody as { data?: unknown[]; models?: unknown[] };
  const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
  return Array.from(new Set(rows.map((row) => String((row as { id?: unknown }).id ?? "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

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
    finalProtocol = protocolParam ?? "openai-compatible";
    finalPathParam = pathParam ?? "";
  } else {
    if (!providerId) return json({ ok: false, error: "providerId is required when baseUrl or apiKey is not provided" }, { status: 400 });
    const provider = (getRuntime().getSettings().customProviders ?? []).find((row) => row.id === providerId);
    if (!provider) return json({ ok: false, error: "Provider not found" }, { status: 404 });
    finalBaseUrl = provider.baseUrl || "";
    finalApiKey = provider.apiKey || "";
    finalProtocol = provider.protocol || "openai-compatible";
    finalPathParam = provider.path || "";
  }

  if (!finalBaseUrl || !finalApiKey) {
    return json({ ok: false, error: "Provider is missing baseUrl or apiKey" }, { status: 400 });
  }

  const protocol = resolveCustomProviderProtocol(finalProtocol);
  const endpoint = protocol === "anthropic"
    ? `${buildAnthropicBaseUrl(finalBaseUrl, finalPathParam)}/v1/models`
    : `${buildOpenAIBaseUrl(finalBaseUrl, finalPathParam)}/models`;

  const dummyProvider = {
    apiKey: finalApiKey
  };

  const headers = protocol === "anthropic"
    ? buildAnthropicCompatibleHeaders(dummyProvider)
    : buildOpenAICompatibleHeaders(dummyProvider);

  try {
    const upstream = await fetch(endpoint, { method: "GET", headers });
    const text = await upstream.text();
    if (!upstream.ok) return json({ ok: false, error: `HTTP ${upstream.status}: ${text.slice(0, 500)}` }, { status: 400 });
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return json({ ok: false, error: "Provider /models response is not valid JSON" }, { status: 400 }); }
    const response: DesktopProviderModelsResponse = { ok: true, models: parseModelIds(parsed) };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
