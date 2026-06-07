import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  try {
    const settings = runtime.getSettings();
    return json({
      ok: true,
      providerMode: settings.providerMode,
      piModelProvider: settings.piModelProvider,
      piModelName: settings.piModelName,
      defaultCustomProviderId: settings.defaultCustomProviderId,
      customProviders: settings.customProviders ?? []
    });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { providerMode, piModelProvider, piModelName, defaultCustomProviderId } = body;
  const runtime = getRuntime();
  try {
    const patch: any = {};
    if (providerMode !== undefined) patch.providerMode = providerMode;
    if (piModelProvider !== undefined) patch.piModelProvider = piModelProvider;
    if (piModelName !== undefined) patch.piModelName = piModelName;
    if (defaultCustomProviderId !== undefined) patch.defaultCustomProviderId = defaultCustomProviderId;

    const updated = runtime.updateSettings(patch);
    return json({
      ok: true,
      providerMode: updated.providerMode,
      piModelProvider: updated.piModelProvider,
      piModelName: updated.piModelName,
      defaultCustomProviderId: updated.defaultCustomProviderId
    });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider } = body;
  if (!provider || !provider.id) {
    return json({ ok: false, error: "Provider and provider.id are required" }, { status: 400 });
  }

  const runtime = getRuntime();
  const currentSettings = runtime.getSettings();
  const currentProviders = currentSettings.customProviders ?? [];

  // Replace existing provider or add new one
  const index = currentProviders.findIndex((p) => p.id === provider.id);
  const updatedProviders = [...currentProviders];
  if (index >= 0) {
    updatedProviders[index] = {
      ...updatedProviders[index],
      ...provider
    };
  } else {
    updatedProviders.push(provider);
  }

  try {
    const updated = runtime.updateSettings({ customProviders: updatedProviders });
    return json({ ok: true, settings: updated });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get("id");
  if (!id) {
    return json({ ok: false, error: "Query parameter 'id' is required" }, { status: 400 });
  }

  const runtime = getRuntime();
  const currentSettings = runtime.getSettings();
  const currentProviders = currentSettings.customProviders ?? [];

  const updatedProviders = currentProviders.filter((p) => p.id !== id);

  try {
    const updated = runtime.updateSettings({ customProviders: updatedProviders });
    return json({ ok: true, settings: updated });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};
