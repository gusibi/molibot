/**
 * The App UI → host UI bridge (缝 5).
 *
 * The bridge only ever carries a *UI intent*. It cannot send a message, start
 * an Agent turn, or write anything: every action below leaves the final keypress
 * with the user, which is why this channel needs no approval chain.
 *
 * ## Versioning
 *
 * v1 shipped with exactly one action, `composer.insert`. v2 adds
 * `composer.attach` and `chat.openSession`.
 *
 * Both versions stay supported, and the *action set is gated per version*
 * rather than the version merely being waved through. Two reasons: apps built
 * against v1 (including everything scaffolded by `miniapp-creator` before 1.4.0)
 * keep working untouched, and a v1 app cannot reach a v2 action by accident —
 * if it wants one it has to declare v2, which is the point of having a version
 * at all. Adding an action to an existing version is therefore never allowed;
 * it would make the same number mean two different capability sets.
 */

export const MINIAPP_BRIDGE_PROTOCOL = "molibot-miniapp" as const;

/** The newest version the host understands. Apps should send this. */
export const MINIAPP_BRIDGE_VERSION = 2 as const;

/** Every version still accepted, oldest first. */
export const MINIAPP_BRIDGE_SUPPORTED_VERSIONS = [1, 2] as const;

export const MINIAPP_BRIDGE_MAX_TEXT_BYTES = 32 * 1024;
/** An attachment path is an app-relative locator, never a long blob. */
export const MINIAPP_BRIDGE_MAX_PATH_LENGTH = 512;
export const MINIAPP_BRIDGE_MAX_SESSION_ID_LENGTH = 200;

export type MiniAppBridgeVersion = (typeof MINIAPP_BRIDGE_SUPPORTED_VERSIONS)[number];

/** Which actions each version may use. A version's set is frozen once shipped. */
const ACTIONS_BY_VERSION: Record<MiniAppBridgeVersion, readonly string[]> = {
  1: ["composer.insert"],
  2: ["composer.insert", "composer.attach", "chat.openSession"]
};

export type MiniAppComposerInsertMode = "append" | "replace";

export interface MiniAppComposerInsert {
  action: "composer.insert";
  text: string;
  mode: MiniAppComposerInsertMode;
}

export interface MiniAppComposerAttach {
  action: "composer.attach";
  /**
   * Path RELATIVE to the app's own dataDir. The host resolves and validates
   * containment before reading anything — an absolute path, a `..` step or a
   * leading slash is rejected here so the host never sees one.
   */
  path: string;
  /** Display name for the composer chip; the host falls back to the basename. */
  name: string;
}

export interface MiniAppChatOpenSession {
  action: "chat.openSession";
  sessionId: string;
}

export type MiniAppBridgeAction =
  | MiniAppComposerInsert
  | MiniAppComposerAttach
  | MiniAppChatOpenSession;

export type MiniAppBridgeParseFailure =
  | "invalid_protocol"
  | "unsupported_version"
  | "unsupported_action"
  | "invalid_payload"
  | "payload_too_large";

export type MiniAppBridgeParseResult =
  | { ok: true; value: MiniAppBridgeAction }
  | { ok: false; reason: MiniAppBridgeParseFailure };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSupportedVersion(value: unknown): value is MiniAppBridgeVersion {
  return MINIAPP_BRIDGE_SUPPORTED_VERSIONS.includes(value as MiniAppBridgeVersion);
}

/**
 * Rejects anything that is not a plain relative path inside the app's dataDir.
 *
 * Shape-only, and deliberately strict: the host still re-validates containment
 * against the real directory (pitfall #6 — a UI-supplied string is never a
 * filesystem path until the owner of that directory says so). This just means a
 * traversal attempt never gets as far as a `realpath` call.
 */
function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > MINIAPP_BRIDGE_MAX_PATH_LENGTH) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  // Windows drive letters and UNC paths are absolute too.
  if (/^[a-zA-Z]:/.test(value) || value.includes("\u0000")) return false;
  return value.split(/[\\/]/).every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function parseMiniAppBridgeMessage(value: unknown): MiniAppBridgeParseResult {
  if (!isPlainRecord(value) || value.protocol !== MINIAPP_BRIDGE_PROTOCOL) {
    return { ok: false, reason: "invalid_protocol" };
  }
  if (!isSupportedVersion(value.version)) {
    return { ok: false, reason: "unsupported_version" };
  }
  if (typeof value.action !== "string" || !ACTIONS_BY_VERSION[value.version].includes(value.action)) {
    return { ok: false, reason: "unsupported_action" };
  }
  if (!isPlainRecord(value.payload)) {
    return { ok: false, reason: "invalid_payload" };
  }

  const payload = value.payload;
  switch (value.action) {
    case "composer.insert": {
      if (typeof payload.text !== "string") return { ok: false, reason: "invalid_payload" };
      if (new TextEncoder().encode(payload.text).byteLength > MINIAPP_BRIDGE_MAX_TEXT_BYTES) {
        return { ok: false, reason: "payload_too_large" };
      }
      const mode = payload.mode ?? "append";
      if (mode !== "append" && mode !== "replace") return { ok: false, reason: "invalid_payload" };
      return { ok: true, value: { action: "composer.insert", text: payload.text, mode } };
    }
    case "composer.attach": {
      if (typeof payload.path !== "string" || !isSafeRelativePath(payload.path)) {
        return { ok: false, reason: "invalid_payload" };
      }
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      return {
        ok: true,
        value: {
          action: "composer.attach",
          path: payload.path,
          // Basename fallback keeps the composer chip readable without making
          // the app supply a label it does not have.
          name: name.slice(0, 200) || payload.path.split(/[\\/]/).pop() || "attachment"
        }
      };
    }
    case "chat.openSession": {
      if (typeof payload.sessionId !== "string") return { ok: false, reason: "invalid_payload" };
      const sessionId = payload.sessionId.trim();
      if (!sessionId || sessionId.length > MINIAPP_BRIDGE_MAX_SESSION_ID_LENGTH) {
        return { ok: false, reason: "invalid_payload" };
      }
      return { ok: true, value: { action: "chat.openSession", sessionId } };
    }
    default:
      // Unreachable while the allow-list above and this switch agree; kept as a
      // labelled failure rather than a silent fallthrough (pitfall #26a).
      return { ok: false, reason: "unsupported_action" };
  }
}
