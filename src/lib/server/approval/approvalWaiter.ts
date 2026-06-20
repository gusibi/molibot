/**
 * Shared approval polling skeleton.
 *
 * Both approval paths block by polling a store for a terminal decision: the
 * ApprovalBroker path (`ToolRuntime.pollApprovalRequest`) and the Host Bash path
 * (`waitForHostBashApprovalAndExecute`). They previously hand-rolled the same
 * timeout/abort/sleep loop. This primitive extracts that loop with zero behavior
 * change — each caller keeps its own store access and terminal handling inside
 * `poll()`, and supplies the abort/timeout fallbacks.
 *
 * Part of the approval-convergence Phase 1 (see
 * docs/designs/agent-runtime/approval-convergence-plan-2026-06-20.md).
 */

export type PollOutcome<T> = { done: true; value: T } | { done: false };

export interface PollUntilResolvedOptions<T> {
  /** Read current state; return `{ done: true, value }` to resolve, `{ done: false }` to keep waiting. */
  poll: () => PollOutcome<T> | Promise<PollOutcome<T>>;
  timeoutMs: number;
  pollMs: number;
  signal?: { readonly aborted: boolean };
  /** Value to resolve with when the signal is aborted. */
  onAbort: () => T | Promise<T>;
  /** Value to resolve with when the deadline elapses without a terminal poll. */
  onTimeout: () => T | Promise<T>;
  /** Injectable for tests. */
  now?: () => number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function pollUntilResolved<T>(options: PollUntilResolvedOptions<T>): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const start = now();

  while (now() - start < options.timeoutMs) {
    if (options.signal?.aborted) {
      return options.onAbort();
    }
    const outcome = await options.poll();
    if (outcome.done) {
      return outcome.value;
    }
    await sleep(options.pollMs);
  }

  return options.onTimeout();
}
