import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { decodeExternalSessionId } from "$lib/server/app/externalSessionsFromContexts.js";
import { sanitizeWebProfileId, sanitizeWebUserId } from "$lib/server/web/identity";
import { resolveAuthorizedConversation } from "$lib/server/web/sessionWorkspace";
import { resolveArtifactFile, ArtifactNotFoundError } from "$lib/server/web/artifactRoute.js";
import { revealAbsolutePath, revealSupported } from "$lib/server/web/revealFile.js";

/**
 * Hands a Session attachment to Finder, the Session-scope peer of the Project
 * inspection reveal route.
 *
 * The WebView only ever sends a workspace-relative path; the absolute path is
 * resolved here, inside the same root + symlink check the artifact preview uses,
 * and never travels back to the client (pitfall #6). External-channel sessions
 * are excluded for the same reason the artifact preview excludes them: their
 * workspaces hold files sent by other people, and handing one to the OS is a
 * stronger capability than streaming its bytes.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    profileId?: unknown;
    sessionId?: unknown;
    projectId?: unknown;
    path?: unknown;
    mode?: unknown;
  };

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const filePath = typeof body.path === "string" ? body.path : "";
  if (!sessionId) return json({ ok: false, error: "sessionId is required" }, { status: 400 });
  if (!filePath) return json({ ok: false, error: "File path is required" }, { status: 400 });
  const mode = body.mode === "open" ? "open" : "reveal";

  if (!revealSupported()) {
    return json({ ok: false, error: "Revealing files is only supported on macOS." }, { status: 400 });
  }
  if (decodeExternalSessionId(sessionId)) {
    return json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const resolved = resolveAuthorizedConversation({
    profileId: sanitizeWebProfileId(typeof body.profileId === "string" ? body.profileId : ""),
    userId: sanitizeWebUserId(""),
    sessionId,
    projectId: typeof body.projectId === "string" && body.projectId ? body.projectId : undefined
  });
  if (!resolved) return json({ ok: false, error: "Not found." }, { status: 404 });

  try {
    const { target } = await resolveArtifactFile({ rootPath: resolved.workspaceDir }, filePath);
    revealAbsolutePath(target, mode);
    return json({ ok: true });
  } catch (cause) {
    // Escape, symlink and missing-file all collapse to the same 404 so the
    // response never reveals the workspace structure.
    if (cause instanceof ArtifactNotFoundError) {
      return json({ ok: false, error: "Not found." }, { status: 404 });
    }
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
