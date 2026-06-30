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
  try {
    providerId = String(((await request.json()) as { providerId?: unknown }).providerId ?? "").trim();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!providerId) return json({ ok: false, error: "providerId is required" }, { status: 400 });
  const provider = (getRuntime().getSettings().customProviders ?? []).find((row) => row.id === providerId);
  if (!provider) return json({ ok: false, error: "Provider not found" }, { status: 404 });
  if (!provider.baseUrl || !provider.apiKey) {
    return json({ ok: false, error: "Provider is missing baseUrl or apiKey" }, { status: 400 });
  }
  const protocol = resolveCustomProviderProtocol(provider.protocol);
  const endpoint = protocol === "anthropic"
    ? `${buildAnthropicBaseUrl(provider.baseUrl, provider.path)}/v1/models`
    : `${buildOpenAIBaseUrl(provider.baseUrl, provider.path)}/models`;
  const headers = protocol === "anthropic"
    ? buildAnthropicCompatibleHeaders(provider)
    : buildOpenAICompatibleHeaders(provider);
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
