import test from "node:test";
import assert from "node:assert/strict";

import { decideWrite, batchDecideWrite, type CanonicalMemory, type StoredMemoryNode } from "../src/index.js";

const baseMemory: CanonicalMemory = {
  path: "mory://user_preference/answer_length",
  type: "user_preference",
  subject: "answer_length",
  value: "用户明确表示更喜欢简短回答",
  confidence: 0.9,
  updatedPolicy: "overwrite",
};

const existingNode: StoredMemoryNode = {
  id: "n1",
  moryPath: baseMemory.path,
  value: baseMemory.value,
  confidence: 0.9,
  updatedAt: new Date().toISOString(),
};

test("decideWrite inserts when path has no existing record", () => {
  const decision = decideWrite([], baseMemory);
  assert.equal(decision.action, "insert");
});

test("decideWrite skips duplicate by default", () => {
  const decision = decideWrite([existingNode], baseMemory);
  assert.equal(decision.action, "skip");
});

test("decideWrite updates on overwrite policy when value changed", () => {
  const incoming: CanonicalMemory = {
    ...baseMemory,
    value: "用户现在希望详细一点的回答",
    confidence: 0.95,
  };
  const decision = decideWrite([existingNode], incoming);
  assert.equal(decision.action, "update");
  if (decision.action === "update") {
    assert.equal(decision.patch.value, incoming.value);
    assert.equal(decision.patch.confidence, incoming.confidence);
  }
});

test("batchDecideWrite reuses batch-updated cache for same path", async () => {
  const incoming: CanonicalMemory[] = [
    {
      ...baseMemory,
      value: "用户喜欢短回答",
      confidence: 0.8,
      updatedPolicy: "merge_append",
    },
    {
      ...baseMemory,
      value: "用户不喜欢很长的解释",
      confidence: 0.85,
      updatedPolicy: "merge_append",
    },
  ];

  const decisions = await batchDecideWrite(
    incoming,
    async () => [existingNode]
  );

  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].decision.action, "update");
  assert.equal(decisions[1].decision.action, "update");
});
