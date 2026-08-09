import assert from "node:assert/strict";
import test from "node:test";
import { DurablePreflightTracker, evaluateDurablePreflightWithModel } from "./preflight.js";

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

test("model preflight parses a bounded promotion decision without allowing free-form output", async () => {
  const result = await evaluateDurablePreflightWithModel({
    message: "Prepare and send the report over several days.",
    effect: effect("non_idempotent")
  }, {
    model: {} as any,
    streamFn: (async function* () {
      yield { type: "text_delta", delta: "```json\n" };
      yield {
        type: "text_delta",
        delta: JSON.stringify({
          mode: "promote",
          reason: "The request spans multiple dependent actions and a later delivery.",
          goal: "Prepare and send the report.",
          acceptanceCriteria: [{ description: "The report is delivered", checkerType: "subjective" }],
          expectedWait: "approval",
          sideEffectRisk: "non_idempotent delivery"
        })
      };
      yield { type: "text_delta", delta: "\n```" };
      yield { type: "done", message: { stopReason: "stop" } };
    }) as any
  });

  assert.equal(result.mode, "promote");
  assert.equal(result.goal, "Prepare and send the report.");
  assert.equal(result.acceptanceCriteria?.[0]?.checkerType, "subjective");
  assert.equal(result.expectedWait, "approval");
});

test("model preflight fails open to ordinary when structured output is invalid", async () => {
  const result = await evaluateDurablePreflightWithModel({
    message: "Edit one file.",
    effect: effect("idempotent")
  }, {
    model: {} as any,
    streamFn: (async function* () {
      yield { type: "text_delta", delta: "not json" };
      yield { type: "done", message: { stopReason: "stop" } };
    }) as any
  });

  assert.equal(result.mode, "ordinary");
  assert.match(result.reason, /invalid structured output/);
});
