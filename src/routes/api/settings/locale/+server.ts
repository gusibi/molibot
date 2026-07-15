import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeLocale, updateLocale } from "$lib/server/settings/handlers/locale";

export const PUT: RequestHandler = async ({ request }) => {
  let body: { locale?: unknown };
  try {
    body = (await request.json()) as { locale?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const locale = sanitizeLocale(body.locale);
  const updated = updateLocale(getRuntime(), locale);
  return json({ ok: true, locale: updated.locale });
};
