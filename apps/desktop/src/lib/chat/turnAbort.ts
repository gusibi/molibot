/**
 * Whether a turn's rejection means "the request was cancelled" rather than a
 * real failure.
 *
 * The shape depends on the transport: plain `fetch` rejects with a DOMException
 * named `AbortError`, while Tauri's HTTP plugin rejects with a bare
 * `Error("Request cancelled")`. Matching only the DOMException made every user
 * Stop pop a red error banner in the packaged app (issue #24).
 */
export function isAbortCause(cause: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (typeof DOMException !== "undefined" && cause instanceof DOMException && cause.name === "AbortError") return true;
  const message = (cause instanceof Error ? cause.message : String(cause ?? "")).trim();
  // Exact transport wordings only: a loose match would hide real runtime errors
  // that merely mention an abort.
  return /^request cancell?ed\.?$/i.test(message)
    || /^the operation was aborted\.?$/i.test(message)
    || /^the user aborted a request\.?$/i.test(message)
    || /^aborted\.?$/i.test(message);
}
