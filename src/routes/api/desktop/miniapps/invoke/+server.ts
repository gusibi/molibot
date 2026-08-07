import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { resolveDesktopSessionFileLocator } from "$lib/server/app/desktopSessionFileLocator.js";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import { invokeMessageAction } from "$lib/server/miniapps/messageActions.js";
import { getMiniAppDataRoot, getMiniAppHost } from "$lib/server/miniapps/registry.js";
import { MiniAppError } from "$lib/server/miniapps/types.js";

interface InvokeRouteOptions {
  host: MiniAppHost;
  channel: string;
  now?: Date;
  dataRoot?: string;
  resolveResource?: Parameters<typeof invokeMessageAction>[2]["resolveResource"];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function _handleMiniAppInvokeRequest(
  request: Request,
  options: InvokeRouteOptions
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Request body must be JSON.", code: "invalid_input" });
  }

  try {
    const result = await invokeMessageAction(
      options.host,
      body as Parameters<typeof invokeMessageAction>[1],
      {
        channel: options.channel,
        now: options.now,
        dataRoot: options.dataRoot,
        resolveResource: options.resolveResource
      }
    );
    return json(200, { ok: true, ...result });
  } catch (cause) {
    if (cause instanceof MiniAppError) {
      const status = cause.code === "not_found"
        ? 404
        : cause.code === "disabled" || cause.code === "forbidden"
          ? 403
          : cause.code === "busy"
            ? 409
            : cause.code === "load_failed"
              ? 503
              : 400;
      return json(status, { ok: false, error: cause.message, code: cause.code });
    }
    return json(500, { ok: false, error: "Mini App action failed.", code: "load_failed" });
  }
}

export const POST: RequestHandler = async ({ request }) => {
  getRuntime();
  return _handleMiniAppInvokeRequest(request, {
    host: getMiniAppHost(),
    channel: "desktop",
    dataRoot: getMiniAppDataRoot(),
    resolveResource: resolveDesktopSessionFileLocator
  });
};
