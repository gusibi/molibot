import assert from "node:assert/strict";
import test from "node:test";
import { getRuntimeToolClassification } from "$lib/server/agent/tools/toolClassification.js";

test("getRuntimeToolClassification: bash => high risk, host source", () => {
  const result = getRuntimeToolClassification("bash");
  assert.equal(result.risk, "high");
  assert.equal(result.source, "host");
});

test("getRuntimeToolClassification: write => medium risk, builtin source", () => {
  const result = getRuntimeToolClassification("write");
  assert.equal(result.risk, "medium");
  assert.equal(result.source, "builtin");
});

test("getRuntimeToolClassification: edit => medium risk, builtin source", () => {
  const result = getRuntimeToolClassification("edit");
  assert.equal(result.risk, "medium");
  assert.equal(result.source, "builtin");
});

test("getRuntimeToolClassification: webSearch => medium risk, builtin source", () => {
  const result = getRuntimeToolClassification("webSearch");
  assert.equal(result.risk, "medium");
  assert.equal(result.source, "builtin");
});

test("getRuntimeToolClassification: mcp__ tool => medium risk, mcp source", () => {
  const result = getRuntimeToolClassification("mcp__some_server__some_tool");
  assert.equal(result.risk, "medium", "MCP tools should have medium risk");
  assert.equal(result.source, "mcp", "MCP tools should have mcp source");
});

test("getRuntimeToolClassification: non-MCP normal tool => low risk, builtin source", () => {
  const result = getRuntimeToolClassification("read");
  assert.equal(result.risk, "low");
  assert.equal(result.source, "builtin");
});

// Lock test guarding the removal of the channelCommands broker bridge:
// the ApprovalBroker (System A) only gates tools whose risk is high/critical.
// `bash` is the sole high-risk classification, and `bash` opts out of the broker
// inside decideBashToolPolicy (always returns `allow`). So with the default
// policy NO built-in tool ever creates a broker request, which is why a Host Bash
// approval never has a co-pending broker request to reconcile. If a future
// non-bash high-risk tool is added, this test fails — a signal to wire that
// tool's approval explicitly rather than relying on the (now removed) bridge.
test("bash is the only high-risk built-in classification, so no built-in tool triggers the broker approval path", () => {
  assert.equal(getRuntimeToolClassification("bash").risk, "high");
  for (const name of [
    "read", "write", "edit", "webSearch", "subagent", "attach", "event",
    "memory", "skillSearch", "skillManage", "switchModel", "imageGenerate",
    "ttsGenerate", "videoGenerate", "mcpInvoke", "loadMcp",
    "mcp__server__tool", "anyUnknownToolName"
  ]) {
    const { risk } = getRuntimeToolClassification(name);
    assert.notEqual(risk, "high", `${name} must not be high risk`);
    assert.notEqual(risk, "critical", `${name} must not be critical risk`);
  }
});
