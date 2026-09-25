import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TurnOrchestrator, type TurnDecisionPolicy } from "./turnOrchestrator.js";

const policy: TurnDecisionPolicy = {
  strategy: "auto",
  fixedLevel: "medium",
  enabled: true,
  selectedDecisionModelId: "jev",
  maxThinkingLevel: "high",
  fallbackThinkingLevel: "low",
  confidenceThreshold: 0.6,
  timeoutMs: 1000
};

test("a logical Turn keeps its policy and resolved decision across a fresh store", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-turn-decision-"));
  const path = join(directory, "settings.sqlite");
  try {
    const first = new TurnOrchestrator(undefined, path);
    assert.deepEqual(first.beginTurnDecision("turn-1", policy), { state: "pending", policy });
    first.markTurnDecisionDispatched("turn-1");
    first.commitTurnDecision("turn-1", {
      strategy: "auto", requestedLevel: "high", confidence: 0.9,
      provider: "typesafe", model: "jev-latest", latencyMs: 42
    });
    first.close();

    const restarted = new TurnOrchestrator(undefined, path);
    const changedPolicy = { ...policy, maxThinkingLevel: "low" as const, fallbackThinkingLevel: "medium" as const };
    assert.deepEqual(restarted.beginTurnDecision("turn-1", changedPolicy), {
      state: "resolved", policy,
      resolution: { strategy: "auto", requestedLevel: "high", confidence: 0.9, provider: "typesafe", model: "jev-latest", latencyMs: 42 }
    });
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unresolved dispatched decision remains identifiable after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-turn-decision-"));
  const path = join(directory, "settings.sqlite");
  try {
    const first = new TurnOrchestrator(undefined, path);
    first.beginTurnDecision("turn-2", policy);
    first.markTurnDecisionDispatched("turn-2");
    first.close();

    const restarted = new TurnOrchestrator(undefined, path);
    assert.deepEqual(restarted.getTurnDecision("turn-2"), { state: "dispatched", policy });
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
