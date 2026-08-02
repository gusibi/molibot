import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMiniApps } from "$lib/server/app/desktopMiniApps";
import { getMiniAppHost } from "$lib/server/miniapps/registry";
import { MiniAppError } from "$lib/server/miniapps/types";
import type {
  DesktopMiniAppsResponse,
  DesktopMiniAppToggleRequest,
  DesktopMiniAppUninstallRequest
} from "$lib/shared/desktop";

/**
 * Fine-grained Mini App management.
 *
 * Separate from `/api/desktop/plugins` on purpose: that route submits the whole
 * Plugins editor, so routing a single toggle through it would also commit every
 * other unsaved field on the page. PATCH here changes exactly one app.
 *
 * The catalog is projected from the live host on every GET rather than cached,
 * so a lazy-load failure or a just-flipped switch shows up immediately.
 */

function payload(): DesktopMiniAppsResponse {
  return { ok: true, items: buildDesktopMiniApps(getMiniAppHost().listCatalog()) };
}

function failure(cause: unknown) {
  const status = cause instanceof MiniAppError
    ? cause.code === "not_found" ? 404 : cause.code === "busy" ? 409 : 400
    : 500;
  return json(
    { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
    { status }
  );
}

export const GET: RequestHandler = async () => {
  getRuntime();
  return json(payload(), { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as DesktopMiniAppToggleRequest;
    if (typeof body?.appId !== "string" || typeof body?.enabled !== "boolean") {
      return json({ ok: false, error: "appId and enabled are required." }, { status: 400 });
    }
    getMiniAppHost().setEnabled(body.appId, body.enabled);
    return json(payload());
  } catch (cause) {
    return failure(cause);
  }
};

export const DELETE: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as DesktopMiniAppUninstallRequest;
    // Only an app id — never a path. Deleting data is opt-in and irreversible,
    // so it must be stated explicitly rather than defaulted.
    if (typeof body?.appId !== "string") {
      return json({ ok: false, error: "appId is required." }, { status: 400 });
    }
    await getMiniAppHost().uninstall(body.appId, { deleteData: body.deleteData === true });
    return json(payload());
  } catch (cause) {
    return failure(cause);
  }
};
