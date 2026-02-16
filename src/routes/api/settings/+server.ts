import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/runtime";
import type { RuntimeSettings, CustomProviderConfig } from "$lib/server/config";

type SettingsBody = Partial<RuntimeSettings> & {
  telegramAllowedChatIds?: string[] | string;
  customProviders?: CustomProviderConfig[] | string;
};

function normalizePatch(body: SettingsBody): Partial<RuntimeSettings> {
  const patch: Partial<RuntimeSettings> = { ...body };

  if (typeof body.telegramAllowedChatIds === "string") {
    patch.telegramAllowedChatIds = body.telegramAllowedChatIds
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  if (typeof body.customProviders === "string") {
    try {
      patch.customProviders = JSON.parse(body.customProviders) as CustomProviderConfig[];
    } catch {
      patch.customProviders = [];
    }
  }

  return patch;
}

export const GET: RequestHandler = async () => {
  const { getSettings } = getRuntime();
  return json({ ok: true, settings: getSettings() });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: SettingsBody;
  try {
    body = (await request.json()) as SettingsBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const updated = runtime.updateSettings(normalizePatch(body));
  return json({ ok: true, settings: updated });
};
