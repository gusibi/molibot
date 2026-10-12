import assert from "node:assert/strict";
import test from "node:test";
import { isReplaySafeTool } from "./sideEffectClassification.js";

test("pure reads are replay-safe after an interruption", () => {
  for (const id of ["read", "fileSearch", "conversationSearch", "conversation_search", "grep", "find", "ls", "skillSearch", "webSearch", "webFetch", "docExtract", "profileFiles", "switchModel"]) {
    assert.equal(isReplaySafeTool(id), true, `${id} should be replay-safe`);
  }
});

test("writes, commands, third-party tools and input-dependent tools are not replay-safe", () => {
  for (const id of ["bash", "write", "edit", "documentExport", "memory", "runtimeTask", "codemode", "subagent", "mcpInvoke", "mcp__x__y", "miniapp__x__y"]) {
    assert.equal(isReplaySafeTool(id), false, `${id} must not be replayed automatically`);
  }
});

test("a declared side-effect class wins over the name table", () => {
  assert.equal(isReplaySafeTool("some-unknown-tool", "pure"), true);
  assert.equal(isReplaySafeTool("read", "non_idempotent"), false);
  assert.equal(isReplaySafeTool("read", "idempotent"), false);
});
