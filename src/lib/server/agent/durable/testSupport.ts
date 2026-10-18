import assert from "node:assert/strict";
import type { DurableExecutionRuntime } from "./runtime.js";
import type { DurableExecutionStore } from "./store.js";

/**
 * Test double for the wakeup worker's single dispatch step: claim one due
 * wakeup, let the runtime consume it, settle the row exactly as the worker
 * would. Keeps tests on the production queue instead of event files.
 */
export async function runNextWakeup(
  runtime: DurableExecutionRuntime,
  store: DurableExecutionStore,
  ownerId = "test-process"
): Promise<void> {
  const [wakeup] = store.claimDueWakeups(ownerId, 1);
  assert.ok(wakeup, "expected a due wakeup");
  const outcome = await runtime.runWakeup(wakeup);
  if (outcome.kind === "done") store.settleWakeup(wakeup.id, { status: "done" });
  else if (outcome.kind === "discarded") store.settleWakeup(wakeup.id, { status: "discarded" });
  else if (outcome.kind === "retry") store.backoffWakeup(wakeup, outcome.error);
  else store.markFatal(outcome.error);
}

/** Drain every due wakeup, bounded so a scheduling loop fails loudly. */
export async function runUntilIdle(
  runtime: DurableExecutionRuntime,
  store: DurableExecutionStore,
  ownerId = "test-process",
  maxRounds = 20
): Promise<number> {
  let rounds = 0;
  for (;;) {
    const [wakeup] = store.claimDueWakeups(ownerId, 1);
    if (!wakeup) break;
    const outcome = await runtime.runWakeup(wakeup);
    if (outcome.kind === "retry" || outcome.kind === "fatal") break;
    store.settleWakeup(wakeup.id, { status: outcome.kind === "done" ? "done" : "discarded" });
    rounds += 1;
    assert.ok(rounds <= maxRounds, "scheduling did not settle");
  }
  return rounds;
}
