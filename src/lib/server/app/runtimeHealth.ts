import os from "node:os";

/**
 * Runtime readiness, reported to whoever is supervising this process.
 *
 * The desktop supervisor used to decide "is the service alive" from
 * `/api/desktop/handshake`, which is a static object literal — it answers 200
 * as long as the HTTP server is listening, whether or not `getRuntime()` can
 * actually build. A service whose runtime fails to initialise therefore looked
 * perfectly healthy while every real API returned 503, and nothing restarted
 * it. This module is the missing signal: `getRuntime()` records the outcome of
 * every initialisation attempt here, and `/api/desktop/health?deep=1` answers
 * from it.
 *
 * Deliberately free of imports from `runtime.ts` — the runtime imports this,
 * and the health route imports both.
 */

export interface RuntimeHealthSnapshot {
  ready: boolean;
  /** Redacted failure message from the most recent failed attempt, if any. */
  error: string | null;
  /** Failed attempts since the last success. Resets to 0 once ready. */
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastReadyAt: string | null;
}

const state: RuntimeHealthSnapshot = {
  ready: false,
  error: null,
  consecutiveFailures: 0,
  lastFailureAt: null,
  lastReadyAt: null
};

/**
 * Strips the host home directory out of a message before it can leave the
 * process. Filesystem errors — the most likely cause of a failed runtime
 * bootstrap — quote the offending absolute path, and this endpoint is readable
 * by the WebView, which must never receive host paths.
 */
export function redactHomePath(message: string): string {
  const home = os.homedir();
  if (!home || home === "/") return message;
  return message.split(home).join("~");
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export function recordRuntimeReady(): void {
  state.ready = true;
  state.error = null;
  state.consecutiveFailures = 0;
  state.lastReadyAt = new Date().toISOString();
}

export function recordRuntimeInitFailure(error: unknown): void {
  state.ready = false;
  state.error = redactHomePath(messageOf(error));
  state.consecutiveFailures += 1;
  state.lastFailureAt = new Date().toISOString();
}

export function runtimeHealthSnapshot(): RuntimeHealthSnapshot {
  return { ...state };
}

/** Test seam. */
export function resetRuntimeHealth(): void {
  state.ready = false;
  state.error = null;
  state.consecutiveFailures = 0;
  state.lastFailureAt = null;
  state.lastReadyAt = null;
}

/**
 * Builds (or reuses) the runtime and reports the outcome, without throwing.
 *
 * `probe` must not surface a stale snapshot: a supervisor asking "is the
 * service usable right now" needs the answer for *now*, so this actively calls
 * the initialiser rather than reading the last recorded result. Initialisation
 * is idempotent once it has succeeded, so a healthy service pays a cache hit.
 */
export function probeRuntime(initialize: () => unknown): RuntimeHealthSnapshot {
  try {
    initialize();
    recordRuntimeReady();
  } catch (error) {
    recordRuntimeInitFailure(error);
  }
  return runtimeHealthSnapshot();
}
