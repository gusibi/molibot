/**
 * The opaque token that identifies a Session root in an artifact preview URL.
 *
 * Shared by the WebView (which builds the URL) and the service (which resolves
 * it). One implementation, not two: if the encoder and decoder drift, every
 * Session HTML preview 404s and silently falls back to the pathless blob, which
 * looks like "relative assets are broken again" rather than like a bug here.
 *
 * A Session has no single id the way a Project does - it is addressed by
 * profile + session (+ project for a Project conversation) - so the three are
 * packed into one base64url segment. The payload deliberately carries ids only:
 * the workspace directory is looked up server-side and a host path never travels
 * to or from the WebView (pitfall #6).
 *
 * Encoding is written against Web APIs (`TextEncoder` / `btoa`) so the same
 * module runs in the WebView and in Node without a polyfill.
 */

export interface SessionArtifactToken {
  profileId: string;
  sessionId: string;
  projectId?: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeSessionArtifactToken(token: SessionArtifactToken): string {
  const payload: SessionArtifactToken = {
    profileId: String(token.profileId ?? ""),
    sessionId: String(token.sessionId ?? "")
  };
  if (token.projectId) payload.projectId = String(token.projectId);
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeSessionArtifactToken(raw: string): SessionArtifactToken | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(String(raw ?? "")))) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const sessionId = String(record.sessionId ?? "");
    // A token without a session addresses nothing; refuse rather than fall back
    // to some default workspace.
    if (!sessionId) return null;
    const profileId = String(record.profileId ?? "");
    const projectId = record.projectId ? String(record.projectId) : undefined;
    return projectId ? { profileId, sessionId, projectId } : { profileId, sessionId };
  } catch {
    return null;
  }
}
