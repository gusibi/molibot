import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import {
  buildAnthropicBaseUrl,
  buildAnthropicCompatibleHeaders,
  buildOpenAIBaseUrl,
  buildOpenAICompatibleHeaders,
  resolveCustomProviderProtocol,
  type ProviderTestPayload
} from "$lib/server/providers/customProtocol";

type ProviderModelsPayload = Pick<ProviderTestPayload, "protocol" | "baseUrl" | "apiKey" | "path">;

function normalizeModelsPayload(body: unknown): ProviderModelsPayload {
  const row = (body ?? {}) as Record<string, unknown>;
  return {
    protocol: resolveCustomProviderProtocol(row.protocol),
    baseUrl: String(row.baseUrl ?? "").trim(),
    apiKey: String(row.apiKey ?? "").trim(),
    path: String(row.path ?? "").trim()
  };
}

function parseModelIdsFromBody(rawBody: unknown): string[] {
  const body = rawBody as { data?: unknown[]; models?: unknown[] };
  const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
  return rows
    .map((row) => String((row as { id?: unknown }).id ?? "").trim())
    .filter(Boolean);
}

export const POST: RequestHandler = async ({ request }) => {
  let payload: ProviderModelsPayload;
  try {
    payload = normalizeModelsPayload(await request.json());
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.baseUrl || !payload.apiKey) {
    return json({ ok: false, error: "baseUrl and apiKey are required" }, { status: 400 });
  }

  const protocol = resolveCustomProviderProtocol(payload.protocol);
  const endpoint = protocol === "anthropic"
    ? `${buildAnthropicBaseUrl(payload.baseUrl, payload.path)}/v1/models`
    : `${buildOpenAIBaseUrl(payload.baseUrl, payload.path)}/models`;
  const headers = protocol === "anthropic"
    ? buildAnthropicCompatibleHeaders(payload)
    : buildOpenAICompatibleHeaders(payload);

  try {
    const response = await fetch(endpoint, { method: "GET", headers });
    const text = await response.text();
    if (!response.ok) {
      return json({
        ok: false,
        error: `HTTP ${response.status}: ${text.slice(0, 500)}`
      }, { status: 400 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "Provider /models response is not valid JSON" }, { status: 400 });
    }

    const models = Array.from(new Set(parseModelIdsFromBody(parsed))).sort((a, b) => a.localeCompare(b));
    return json({ ok: true, models });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};
