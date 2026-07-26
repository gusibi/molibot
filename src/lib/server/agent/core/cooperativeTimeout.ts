export interface CooperativeTimeoutOptions {
  timeoutMs: number;
  settleGraceMs?: number;
  onTimeout: () => Promise<void> | void;
}

export type CooperativeTimeoutResult<T> =
  | { status: "settled"; value: T }
  | { status: "timeout" };

/**
 * Request cooperative cancellation at the deadline, allow a bounded settlement
 * window, then return timeout even when the underlying promise ignores abort.
 */
export async function settleWithCooperativeTimeout<T>(
  promise: Promise<T>,
  options: CooperativeTimeoutOptions
): Promise<CooperativeTimeoutResult<T>> {
  const timeoutMs = Math.max(0, options.timeoutMs);
  const settleGraceMs = Math.max(0, options.settleGraceMs ?? 5_000);
  let timeout: NodeJS.Timeout | undefined;
  let grace: NodeJS.Timeout | undefined;
  const settled = promise.then((value) => ({ status: "settled" as const, value }));
  const deadline = new Promise<{ status: "deadline" }>((resolve) => {
    timeout = setTimeout(() => {
      try {
        void Promise.resolve(options.onTimeout()).catch(() => undefined);
      } catch {
        // Cancellation is best-effort; a broken hook must not crash the scheduler.
      }
      resolve({ status: "deadline" });
    }, timeoutMs);
  });

  const first = await Promise.race([settled, deadline]);
  if (timeout) clearTimeout(timeout);
  if (first.status === "settled") return first;

  const graceExpired = new Promise<{ status: "timeout" }>((resolve) => {
    grace = setTimeout(() => resolve({ status: "timeout" }), settleGraceMs);
  });
  const final = await Promise.race([settled, graceExpired]);
  if (grace) clearTimeout(grace);
  return final;
}
