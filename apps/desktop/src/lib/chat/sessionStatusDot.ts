/**
 * Per-session run status + status-dot derivation (plan §7.3 / §8).
 *
 * Pure (no runes) so the classification logic is unit-testable. The reactive
 * registry (`sessionRuntimeRegistry.svelte.ts`) holds these values in `$state`
 * and exposes the derived dot to the UI.
 */

export type SessionRuntimeKey = string;

/** Stable key for a session's runtime entry: `${profileId}:${sessionId}`. */
export function sessionRuntimeKey(profileId: string, sessionId: string): SessionRuntimeKey {
  return `${profileId}:${sessionId}`;
}

/**
 * Authoritative per-session status. `running`/`waiting` are live (client turn
 * or restored server run); `completed`/`failed` are terminal and — for a
 * background session — surface as an unread dot until the user opens the
 * session (plan §8.2). `idle` shows no dot.
 */
export type SessionRunStatus = "idle" | "running" | "waiting" | "completed" | "failed";

export type SessionStatusDotColor = "running" | "waiting" | "completed" | "failed";

export interface SessionStatusDot {
  color: SessionStatusDotColor;
  /** i18n key for the dot's aria-label / tooltip text. */
  labelKey: "running" | "waitingApproval" | "completed" | "failed";
}

/**
 * Derives the sidebar status dot from a session's status and whether it is the
 * currently-viewed session (plan §8.1 / §8.2). The currently-viewed session
 * never shows a terminal unread dot: success shows nothing, failure shows the
 * error inline. Color is never the sole signal — `labelKey` carries the
 * localizable status text for aria/tooltip (plan §8.3).
 */
export function deriveStatusDot(
  status: SessionRunStatus,
  isActive: boolean
): SessionStatusDot | null {
  if (status === "waiting") return { color: "waiting", labelKey: "waitingApproval" };
  if (status === "running") return { color: "running", labelKey: "running" };
  if (status === "completed" && !isActive) return { color: "completed", labelKey: "completed" };
  if (status === "failed" && !isActive) return { color: "failed", labelKey: "failed" };
  return null;
}

/**
 * Computes the next authoritative status from a controller turn-view snapshot.
 *
 * While a client turn is in flight, status mirrors it (`running` / `waiting`).
 * The moment the turn ends (`sending` true→false), a *background* session
 * records a terminal status (`completed`/`failed`) so its dot can surface as
 * unread; the *active* session goes `idle` because its outcome is already
 * visible inline (success: nothing; failure: the error banner) — plan §8.2.
 * Outside a turn transition the status is left untouched so a background
 * terminal status persists until the user opens the session.
 */
export function nextTurnStatus(input: {
  prevSending: boolean;
  sending: boolean;
  pendingApproval: boolean;
  isActive: boolean;
  error: string;
  current: SessionRunStatus;
}): SessionRunStatus {
  const { prevSending, sending, pendingApproval, isActive, error, current } = input;
  if (sending) return pendingApproval ? "waiting" : "running";
  if (prevSending) {
    return isActive ? "idle" : error ? "failed" : "completed";
  }
  return current;
}

/**
 * Maps a restored server-run status (from `GET /api/desktop/session-runs`) onto
 * the registry's `SessionRunStatus`. Reconnect only restores live runs; a run
 * that has already finished is not present in the response (plan §11.2).
 */
export function statusFromRestoredRun(
  runStatus: "running" | "waiting_for_approval"
): "running" | "waiting" {
  return runStatus === "waiting_for_approval" ? "waiting" : "running";
}
