import assert from "node:assert/strict";
import test from "node:test";
import { classifyToolSideEffect } from "$lib/server/agent/tools/sideEffectClassification.js";

test("side-effect classification is deterministic and hashes the full input", () => {
  const first = classifyToolSideEffect("write", { file_path: "a.md", content: "one" });
  const same = classifyToolSideEffect("write", { file_path: "a.md", content: "one" });
  const changed = classifyToolSideEffect("write", { file_path: "a.md", content: "two" });

  assert.equal(first.sideEffectClass, "idempotent");
  assert.equal(first.idempotencyKey, same.idempotencyKey);
  assert.notEqual(first.idempotencyKey, changed.idempotencyKey);
  assert.equal(
    classifyToolSideEffect("write", { content: "one", file_path: "a.md" }).idempotencyKey,
    first.idempotencyKey
  );
  assert.equal(classifyToolSideEffect("read", { path: "a.md" }).sideEffectClass, "pure");
  assert.equal(classifyToolSideEffect("bash", { command: "touch a.md" }).sideEffectClass, "non_idempotent");
  assert.equal(classifyToolSideEffect("runtimeTask", { action: "get", taskId: "task-1" }).sideEffectClass, "pure");
  assert.equal(classifyToolSideEffect("runtimeTask", { action: "update", taskId: "task-1", patch: { enabled: false } }).sideEffectClass, "idempotent");
  assert.equal(classifyToolSideEffect("runtimeTask", { action: "create", type: "todo", text: "Buy milk" }).sideEffectClass, "non_idempotent");
  assert.equal(classifyToolSideEffect("subagent", { mode: "single", task: "inspect" }).sideEffectClass, "non_idempotent");
});
