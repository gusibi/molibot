import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMiniAppsPayload } from "$lib/server/app/desktopMiniApps";
import { getMiniAppHost, getMiniAppInstaller } from "$lib/server/miniapps/registry";
import { MiniAppError } from "$lib/server/miniapps/types";
import type { MiniAppInstallRequest } from "$lib/server/miniapps/install";
import type { DesktopMiniAppInstallRequest } from "$lib/shared/desktop";

/**
 * Installs a Mini App from a local directory, a local ZIP, or a GitHub
 * repository.
 *
 * The installed code does **not** run until the service restarts (V1 has no hot
 * reload), which is why the response says so explicitly rather than leaving the
 * desktop to imply the app is live.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as DesktopMiniAppInstallRequest;

    let installRequest: MiniAppInstallRequest;
    if (body?.source === "directory" || body?.source === "zip") {
      if (typeof body.path !== "string" || body.path.trim().length === 0) {
        return json({ ok: false, error: "A path is required." }, { status: 400 });
      }
      installRequest = { source: body.source, path: body.path };
    } else if (body?.source === "github") {
      if (typeof body.repo !== "string" || body.repo.trim().length === 0) {
        return json({ ok: false, error: "A repository is required." }, { status: 400 });
      }
      installRequest = { source: "github", repo: body.repo, ref: body.ref };
    } else {
      return json({ ok: false, error: "Unsupported install source." }, { status: 400 });
    }

    const result = await getMiniAppInstaller().install(installRequest);
    // Rescan so the new app appears in the catalog immediately, even though its
    // code will not be loaded until the restart.
    getMiniAppHost().refresh();

    return json({
      ok: true,
      ...buildDesktopMiniAppsPayload(getMiniAppHost()),
      installedId: result.appId,
      replaced: result.replaced,
      restartRequired: true
    });
  } catch (cause) {
    const status = cause instanceof MiniAppError ? 400 : 500;
    return json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status }
    );
  }
};
