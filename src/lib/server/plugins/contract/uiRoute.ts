import fs, { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { isValidPluginId, pluginPackageDir } from "$lib/server/plugins/contract/paths.js";
import { isSafeRelativePath, resolveContainedPath } from "$lib/server/infra/pathSafety.js";

/**
 * Static UI asset serving for custom-mode Molibot plugins (issue #34).
 *
 * Enforces:
 * - Direct containment inside the plugin's `ui/` directory.
 * - Restrictive CSP applied to HTML entry documents.
 * - No directory traversal or dotfile leaks.
 */

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

/**
 * Origins allowed to frame a plugin settings document.
 */
const FRAME_ANCESTORS = [
  "'self'",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "molibot-plugin: http://molibot-plugin.localhost"
];

function documentCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'", // Custom UI communicates strictly via postMessage bridge
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`
  ].join("; ");
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function handlePluginUiRequest(pluginId: string, assetPath: string): Response {
  if (!isValidPluginId(pluginId)) {
    return jsonError(400, "Invalid plugin id");
  }

  const pkgDir = pluginPackageDir(pluginId);
  if (pkgDir === null) {
    return jsonError(404, "Plugin package not found");
  }

  const uiDir = path.join(pkgDir, "ui");
  if (!fs.existsSync(uiDir)) {
    return jsonError(404, "Plugin has no ui/ directory");
  }

  // Normalize requested relative path
  let targetRelative = assetPath.replace(/^\/+/, "");
  if (!targetRelative || targetRelative === "/") {
    targetRelative = "index.html";
  }

  if (!isSafeRelativePath(targetRelative) || targetRelative.startsWith(".")) {
    return jsonError(400, "Invalid asset path");
  }

  const resolved = resolveContainedPath(uiDir, targetRelative, { requireFile: true });
  if (resolved === null) {
    return jsonError(404, "Asset not found");
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (contentType.startsWith("text/html")) {
    headers["content-security-policy"] = documentCsp();
  }

  const stream = Readable.toWeb(createReadStream(resolved)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
