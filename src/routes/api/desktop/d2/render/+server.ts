import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import {
  D2RenderError,
  D2_RENDER_TIMEOUT_MS,
  MAX_D2_OUTPUT_BYTES,
  MAX_D2_SOURCE_BYTES,
  renderD2,
  type D2RenderTheme,
  type D2RenderOptions
} from "$lib/server/diagrams/d2Render.js";

export const _MAX_D2_SOURCE_BYTES = MAX_D2_SOURCE_BYTES;
export const _MAX_D2_OUTPUT_BYTES = MAX_D2_OUTPUT_BYTES;
export const _D2_RENDER_TIMEOUT_MS = D2_RENDER_TIMEOUT_MS;

interface D2RouteOptions extends D2RenderOptions {}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function _handleD2RenderRequest(request: Request, options: D2RouteOptions = {}): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Request body must be JSON.", code: "invalid_input" });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const source = raw.source;
  const theme = raw.theme ?? "light";
  if (typeof source !== "string" || !source.trim()) {
    return json(400, { ok: false, error: "source is required.", code: "invalid_input" });
  }
  if (sourceByteLength(source) > MAX_D2_SOURCE_BYTES) {
    return json(413, { ok: false, error: "D2 source is too large.", code: "source_too_large" });
  }
  if (theme !== "light" && theme !== "dark") {
    return json(400, { ok: false, error: "theme must be light or dark.", code: "invalid_input" });
  }

  try {
    const svg = await renderD2(source, theme as D2RenderTheme, options);
    return json(200, { ok: true, svg });
  } catch (cause) {
    if (cause instanceof D2RenderError) {
      return json(cause.code === "renderer_unavailable" ? 503 : 502, {
        ok: false,
        error: cause.code === "invalid_renderer_output" ? "D2 rendering failed." : "D2 rendering failed.",
        code: cause.code
      });
    }
    return json(502, { ok: false, error: "D2 rendering failed.", code: "upstream_failed" });
  }
}

function sourceByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

export const POST: RequestHandler = async ({ request }) => {
  getRuntime();
  return _handleD2RenderRequest(request);
};
