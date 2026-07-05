import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  deleteCustomProvider,
  readCustomProvidersConfig,
  replaceCustomProviders,
  updateGlobalProviderSettings,
  upsertCustomProvider
} from "$lib/server/settings/handlers/customProviders";

export const GET: RequestHandler = async () => {
  try {
    const config = readCustomProvidersConfig(getRuntime());
    return json({ ok: true, ...config });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const config = updateGlobalProviderSettings(getRuntime(), body);
    return json({ ok: true, ...config });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { provider?: unknown; customProviders?: unknown };
  try {
    body = (await request.json()) as { provider?: unknown; customProviders?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const runtime = getRuntime();
    if (body.customProviders !== undefined) {
      const config = replaceCustomProviders(runtime, body.customProviders);
      return json({ ok: true, ...config });
    }
    if (!body.provider || typeof body.provider !== "object") {
      return json({ ok: false, error: "provider is required" }, { status: 400 });
    }
    const { config, saved } = upsertCustomProvider(runtime, body.provider);
    return json({ ok: true, ...config, provider: saved });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get("id");
  if (!id) {
    return json({ ok: false, error: "Query parameter 'id' is required" }, { status: 400 });
  }
  try {
    const config = deleteCustomProvider(getRuntime(), id);
    return json({ ok: true, ...config });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};
