import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMiniAppsPayload } from "$lib/server/app/desktopMiniApps";
import { getMiniAppHost } from "$lib/server/miniapps/registry";
import { MiniAppError } from "$lib/server/miniapps/types";
import type { DesktopMiniAppUpdateRequest, DesktopMiniAppUpdateResponse } from "$lib/shared/desktop";

/**
 * Reinstalls a built-in Mini App from the copy this Molibot build ships.
 *
 * Separate from `/install` because the payload is different in kind: install
 * takes a source the owner chose and must be trusted, while this takes only an
 * app id and always writes code that shipped inside the app the owner is
 * already running. It replaces code only — the app's data directory is never
 * touched, which is the reason the button exists.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as DesktopMiniAppUpdateRequest;
    if (typeof body?.appId !== "string" || body.appId.length === 0) {
      return json({ ok: false, error: "appId is required." }, { status: 400 });
    }

    const host = getMiniAppHost();
    await host.updateBuiltin(body.appId);
    const payload = buildDesktopMiniAppsPayload(host);
    const response: DesktopMiniAppUpdateResponse = {
      ok: true,
      ...payload,
      version: payload.items.find((item) => item.id === body.appId)?.version ?? "",
      restartRequired: true
    };
    return json(response);
  } catch (cause) {
    const status = cause instanceof MiniAppError
      ? cause.code === "not_found" ? 404 : cause.code === "busy" ? 409 : 400
      : 500;
    return json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status }
    );
  }
};
