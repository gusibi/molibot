import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMiniAppsPayload } from "$lib/server/app/desktopMiniApps";
import { getMiniAppHost } from "$lib/server/miniapps/registry";
import { MiniAppError } from "$lib/server/miniapps/types";
import type {
  DesktopMiniAppBuiltinInstallRequest,
  DesktopMiniAppBuiltinInstallResponse
} from "$lib/shared/desktop";

/**
 * The built-in Mini App catalog: what this Molibot build ships, and whether the
 * owner has it.
 *
 * Distinct from `/api/desktop/miniapps`, which projects what is *installed*. A
 * built-in the owner never installed — or deliberately uninstalled — has no
 * catalog row at all, so without this route it can never be offered back; the
 * app would simply vanish from the product.
 *
 * POST installs or reinstalls from the bundled copy. It is not `/install`
 * because there is no owner-supplied source to trust here: the code shipped
 * inside the app the owner is already running, and the app's data directory is
 * never touched.
 */

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
  return json(
    { ok: true, ...buildDesktopMiniAppsPayload(getMiniAppHost()) },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as DesktopMiniAppBuiltinInstallRequest;
    if (typeof body?.appId !== "string" || body.appId.length === 0) {
      return json({ ok: false, error: "appId is required." }, { status: 400 });
    }

    const host = getMiniAppHost();
    await host.installBuiltin(body.appId);
    const payload = buildDesktopMiniAppsPayload(host);
    const response: DesktopMiniAppBuiltinInstallResponse = {
      ok: true,
      ...payload,
      version: payload.builtin.find((item) => item.id === body.appId)?.installedVersion ?? "",
      restartRequired: true
    };
    return json(response);
  } catch (cause) {
    return failure(cause);
  }
};
