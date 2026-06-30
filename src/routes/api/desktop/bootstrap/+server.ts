import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolveDesktopProfiles } from "$lib/server/app/desktopBootstrap";
import { getRuntime } from "$lib/server/app/runtime";
import type { DesktopBootstrapResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const payload: DesktopBootstrapResponse = {
    ok: true,
    profiles: resolveDesktopProfiles(getRuntime().getSettings())
  };
  return json(payload, {
    headers: { "Cache-Control": "no-store" }
  });
};
