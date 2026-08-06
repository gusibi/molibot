import { promises as fs } from "node:fs";
import path from "node:path";
import { getProjectStore } from "$lib/server/projects/store.js";
import { resolveProjectPath } from "$lib/server/projects/inspection.js";
import { decodeSessionArtifactToken } from "$lib/shared/artifactToken.js";

/**
 * Static artifact serving for the Artifact Panel's HTML preview (PRD §3.38
 * Slice 1a). Mirrors the Mini App transport's trust model: a fixed custom origin
 * (`molibot-artifact://`) the build-time CSP can name, forwarded to this route
 * by the Tauri adapter, which sets a marker header no web page can forge. The
 * route never accepts a host absolute path - it resolves a Project-relative path
 * against the registered root and rejects every escape, including symlinks
 * (pitfall #6, test seam #2).
 */

export const ARTIFACT_PROXY_HEADER = "x-molibot-artifact-proxy";
export const ARTIFACT_PROXY_VALUE = "v1";

/** Content types the preview serves. Unknown extensions fall back to octet-stream. */
const ARTIFACT_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf"
};

const ARTIFACT_FRAME_ANCESTORS = [
  "'self'",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420"
];

export function hasArtifactProxyHeader(request: Request): boolean {
  return request.headers.get(ARTIFACT_PROXY_HEADER) === ARTIFACT_PROXY_VALUE;
}

/**
 * The Content-Security-Policy applied to every served HTML document. The iframe
 * runs with `sandbox="allow-scripts"` and no `allow-same-origin`, so its origin
 * is null and `'self'` cannot match - subresources are therefore allowed via the
 * `molibot-artifact:` scheme (relative refs resolve there through the Tauri
 * transport), while `default-src 'none'` keeps the preview off the network and
 * `object-src 'none'` / `base-uri 'none'` / `form-action 'none'` close the usual
 * plug-in and redirect escape hatches.
 */
export function artifactDocumentCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' molibot-artifact:",
    "style-src 'unsafe-inline' molibot-artifact:",
    "img-src data: blob: molibot-artifact:",
    "font-src data: blob: molibot-artifact:",
    "connect-src molibot-artifact:",
    "media-src blob: molibot-artifact:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ARTIFACT_FRAME_ANCESTORS.join(" ")}`
  ].join("; ");
}

export function artifactContentType(fileName: string): { contentType: string; isHtml: boolean } {
  const ext = path.extname(fileName).toLowerCase();
  const contentType = ARTIFACT_CONTENT_TYPES[ext] ?? "application/octet-stream";
  return { contentType, isHtml: ext === ".html" || ext === ".htm" || ext === ".xhtml" };
}

export interface ArtifactTarget {
  target: string;
  contentType: string;
  isHtml: boolean;
}

/**
 * Resolves a Project-relative artifact path against its registered root and
 * returns the validated absolute target. Throws `ArtifactNotFoundError` for any
 * escape, missing file, symlink, or unknown project - the caller turns every
 * failure into a generic 404 so no host absolute path or root structure leaks
 * (pitfall #6, test seam #2).
 */
export class ArtifactNotFoundError extends Error {}

export async function resolveArtifactFile(
  project: { rootPath: string },
  rest: string
): Promise<ArtifactTarget> {
  try {
    // `allowSymlink: false` + `requireExists: true` -> resolveProjectPath rejects
    // `..` escapes, symlinked files, and targets that realpath outside the root.
    const { target } = await resolveProjectPath(project, rest, false, true);
    const stat = await fs.lstat(target);
    if (!stat.isFile()) throw new ArtifactNotFoundError("Not a file.");
    const { contentType, isHtml } = artifactContentType(rest);
    return { target, contentType, isHtml };
  } catch (cause) {
    // Every failure becomes the same generic not-found error so the caller can
    // return a 404 without leaking which check failed (pitfall #6, test seam #2).
    if (cause instanceof ArtifactNotFoundError) throw cause;
    throw new ArtifactNotFoundError(cause instanceof Error ? cause.message : String(cause));
  }
}

export async function resolveArtifactTarget(input: {
  scope: string;
  token: string;
  rest: string;
}): Promise<ArtifactTarget> {
  if (input.scope === "project") {
    const project = getProjectStore().get(input.token);
    if (!project) throw new ArtifactNotFoundError("Unknown project.");
    return resolveArtifactFile(project, input.rest);
  }
  if (input.scope === "session") {
    return resolveSessionArtifactTarget(input.token, input.rest);
  }
  throw new ArtifactNotFoundError("Unsupported artifact scope.");
}

/**
 * Resolves a Session artifact against that Session's workspace root.
 *
 * The root is the workspace, not the file's own directory, so an agent-written
 * page's relative `css/`, `img/` and `../assets/` references resolve the same
 * way they do in Project scope. Authorization is the same check the attachment
 * byte route makes, through the same shared helper - an unreachable Session
 * yields the generic not-found.
 *
 * External-channel sessions are deliberately excluded: their workspaces hold
 * files sent by other people, and a rendered HTML preview is a stronger
 * capability than the byte-streaming the file route gives them. Those sessions
 * keep the single-file blob preview.
 *
 * The runtime lookups are imported lazily so this module stays importable by the
 * path-validation unit tests without booting a runtime.
 */
async function resolveSessionArtifactTarget(rawToken: string, rest: string): Promise<ArtifactTarget> {
  const token = decodeSessionArtifactToken(rawToken);
  if (!token) throw new ArtifactNotFoundError("Invalid session artifact token.");

  const { decodeExternalSessionId } = await import("$lib/server/app/externalSessionsFromContexts.js");
  if (decodeExternalSessionId(token.sessionId)) {
    throw new ArtifactNotFoundError("External sessions do not serve rendered artifacts.");
  }

  const { resolveAuthorizedConversation } = await import("$lib/server/web/sessionWorkspace.js");
  const { sanitizeWebProfileId, sanitizeWebUserId } = await import("$lib/server/web/identity.js");
  const resolved = resolveAuthorizedConversation({
    profileId: sanitizeWebProfileId(token.profileId),
    userId: sanitizeWebUserId(""),
    sessionId: token.sessionId,
    projectId: token.projectId
  });
  if (!resolved) throw new ArtifactNotFoundError("Unknown session.");

  return resolveArtifactFile({ rootPath: resolved.workspaceDir }, rest);
}
