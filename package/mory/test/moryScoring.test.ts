import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreWriteCandidate,
  type CanonicalMemory,
  type StoredMemoryNode,
} from "../src/index.js";

const incomingBase: CanonicalMemory = {
  path: "mory://user_preference/language",
  type: "user_preference",
  subject: "language",
  value: "用户更偏好中文回答",
  confidence: 0.9,
  updatedPolicy: "overwrite",
};

test("scoreWriteCandidate accepts high-value novel memory", () => {
  const result = scoreWriteCandidate([], incomingBase, {
    mode: "weighted",
    threshold: 0.55,
  });
  assert.equal(result.shouldWrite, true);
  assert.ok(result.score >= 0.55);
  assert.equal(result.components.novelty, 1);
});

test("scoreWriteCandidate rejects low-novelty memory", () => {
  const existing: StoredMemoryNode[] = [
    {
      id: "1",
      moryPath: incomingBase.path,
      value: incomingBase.value,
      confidence: 0.88,
      updatedAt: new Date().toISOString(),
    },
  ];
  const result = scoreWriteCandidate(existing, incomingBase, {
    minNovelty: 0.1,
  });
  assert.equal(result.shouldWrite, false);
  assert.match(result.reason, /Novelty/);
});

test("product mode is stricter than weighted mode", () => {
  const weighted = scoreWriteCandidate([], { ...incomingBase, confidence: 0.7 }, {
    mode: "weighted",
  });
  const product = scoreWriteCandidate([], { ...incomingBase, confidence: 0.7 }, {
    mode: "product",
  });
  assert.ok(product.score <= weighted.score);
});
