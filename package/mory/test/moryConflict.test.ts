import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveMemoryConflict,
  type CanonicalMemory,
  type VersionedMemoryNode,
} from "../src/index.js";

const existing: VersionedMemoryNode = {
  id: "mem-1",
  moryPath: "mory://user_preference/answer_length",
  value: "用户喜欢简短回答",
  confidence: 0.7,
  updatedAt: "2026-02-20T00:00:00.000Z",
  observedAt: "2026-02-20T00:00:00.000Z",
  version: 1,
};

test("overwrite policy replaces existing memory", () => {
  const incoming: CanonicalMemory = {
    path: existing.moryPath,
    type: "user_preference",
    subject: "answer_length",
    value: "用户希望详细回答",
    confidence: 0.9,
    updatedPolicy: "overwrite",
    observedAt: "2026-02-27T00:00:00.000Z",
  };
  const res = resolveMemoryConflict(existing, incoming);
  assert.equal(res.action, "replace_existing");
  assert.ok(res.next);
  assert.equal(res.next?.version, 2);
});

test("highest_confidence keeps existing when incoming is weaker", () => {
  const incoming: CanonicalMemory = {
    path: existing.moryPath,
    type: "user_preference",
    subject: "answer_length",
    value: "用户偏好详细回答",
    confidence: 0.6,
    updatedPolicy: "highest_confidence",
  };
  const res = resolveMemoryConflict(existing, incoming);
  assert.equal(res.action, "keep_existing");
});

test("contradictory values trigger conflict-aware resolution", () => {
  const incoming: CanonicalMemory = {
    path: existing.moryPath,
    type: "user_preference",
    subject: "answer_length",
    value: "用户不喜欢简短回答",
    confidence: 0.95,
    updatedPolicy: "highest_confidence",
    observedAt: "2026-02-27T00:00:00.000Z",
  };
  const res = resolveMemoryConflict(existing, incoming);
  assert.equal(res.conflict, true);
  assert.ok(res.action === "replace_existing" || res.action === "flag_conflict");
});
