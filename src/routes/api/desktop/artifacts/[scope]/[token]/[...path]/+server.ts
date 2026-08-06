import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { promises as fs } from "node:fs";
import {
  artifactDocumentCsp,
  hasArtifactProxyHeader,
  resolveArtifactTarget
} from "$lib/server/web/artifactRoute.js";
import { streamFileWithRange } from "$lib/server/http/rangeResponse.js";

/**
 * Serves Project-rooted artifact files (HTML + their relative css/js/img) for the
 * Artifact Panel's HTML preview. Reachable only through the `molibot-artifact://`
 * Tauri transport, which sets `x-molibot-artifact-proxy: v1`; a plain web page
 * cannot forge that header (no CORS allowlist is ever returned), so a port scan
 * of the loopback service learns nothing and drives nothing.
 */
export const GET: RequestHandler = async ({ params, request }) => {
  if (!hasArtifactProxyHeader(request)) {
    return json({ ok: false, error: "Artifact routes are only reachable through the Molibot desktop transport." }, { status: 403 });
  }

  let resolved;
  try {
    resolved = await resolveArtifactTarget({
      scope: params.scope,
      token: params.token,
      rest: params.path ?? ""
    });
  } catch (cause) {
    // Every failure (unknown project, escape, symlink, missing file) becomes a
    // generic 404 so the response never reveals the host root structure.
    return json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const stat = await fs.stat(resolved.target);
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (resolved.isHtml) {
    headers["content-security-policy"] = artifactDocumentCsp();
  }
  return streamFileWithRange({
    path: resolved.target,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    mimeType: resolved.contentType,
    rangeHeader: request.headers.get("range"),
    ifNoneMatch: request.headers.get("if-none-match"),
    headers
  });
};
