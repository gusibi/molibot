import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import {
  ProviderModelsError,
  listProviderModels,
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

  try {
    const models = await listProviderModels(payload);
    return json({ ok: true, models });
  } catch (error) {
    if (error instanceof ProviderModelsError) {
      return json({ ok: false, error: error.message }, { status: error.status });
    }
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};
