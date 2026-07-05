import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { ProviderModelsError, listProviderModels } from "$lib/server/providers/customProtocol";
import type { DesktopProviderModelsResponse } from "$lib/shared/desktop";

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
  try {
    const models = await listProviderModels({
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      path: provider.path
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
