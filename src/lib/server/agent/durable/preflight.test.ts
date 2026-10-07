import assert from "node:assert/strict";
import test from "node:test";
import { DurablePreflightTracker } from "./preflight.js";

const effect = (sideEffectClass: "idempotent" | "queryable" | "non_idempotent") => ({
  toolId: "tool",
  sideEffectClass,
  idempotencyKey: sideEffectClass,
  targetSummary: "target",
  contentSummary: "content"
});

test("lazy preflight evaluates each tier once and re-evaluates higher tiers", async () => {
  const seen: string[] = [];
  const tracker = new DurablePreflightTracker(async ({ effect: current }) => {
    seen.push(current.sideEffectClass);
    return { mode: "ordinary", reason: "ordinary" };
  });

  assert.equal((await tracker.evaluate({ message: "work", effect: effect("idempotent") })).evaluated, true);
  assert.equal((await tracker.evaluate({ message: "work", effect: effect("idempotent") })).evaluated, false);
  assert.equal((await tracker.evaluate({ message: "work", effect: effect("queryable") })).evaluated, true);
  assert.equal((await tracker.evaluate({ message: "work", effect: effect("idempotent") })).evaluated, false);
  assert.equal((await tracker.evaluate({ message: "work", effect: effect("non_idempotent") })).preflightIndex, 3);
  assert.deepEqual(seen, ["idempotent", "queryable", "non_idempotent"]);
  assert.equal(tracker.countEvaluated, 3);
});
