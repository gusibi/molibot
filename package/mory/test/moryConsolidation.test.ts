import test from "node:test";
import assert from "node:assert/strict";

import {
  consolidateEpisodes,
  toCanonicalFromRule,
  buildWorkspacePath,
  isWorkspacePath,
  shouldExpireWorkingMemory,
  toWorkingMemory,
} from "../src/index.js";

test("consolidateEpisodes creates semantic rule with enough support", () => {
  const rules = consolidateEpisodes([
    {
      id: "e1",
      path: "mory://user_preference/answer_length",
      type: "user_preference",
      subject: "answer_length",
      value: "用户喜欢简短回答",
      confidence: 0.9,
    },
    {
      id: "e2",
      path: "mory://user_preference/answer_length",
      type: "user_preference",
      subject: "answer_length",
      value: "用户更偏好简洁回答",
      confidence: 0.85,
    },
  ]);

  assert.equal(rules.length, 1);
  assert.equal(rules[0].supportCount, 2);
  const canonical = toCanonicalFromRule(rules[0]);
  assert.equal(canonical.type, "user_preference");
  assert.equal(canonical.updatedPolicy, "overwrite");
});

test("workspace helpers build and validate session-scoped paths", () => {
  const path = buildWorkspacePath("session-ABC", "scratch_state");
  assert.ok(isWorkspacePath(path));

  const mem = toWorkingMemory(
    {
      subject: "scratch_state",
      value: "当前任务: 重构记忆检索器",
      confidence: 0.8,
    },
    "session-ABC",
    "scratch_state"
  );
  assert.ok(mem.path.startsWith("mory://task/session."));
  assert.equal(mem.type, "task");
});

test("shouldExpireWorkingMemory respects ttl", () => {
  assert.equal(
    shouldExpireWorkingMemory(new Date(Date.now() - (26 * 60 * 60 * 1000)).toISOString(), 24),
    true
  );
  assert.equal(
    shouldExpireWorkingMemory(new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(), 24),
    false
  );
});
