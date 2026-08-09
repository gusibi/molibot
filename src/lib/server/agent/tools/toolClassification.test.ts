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

test("getRuntimeToolClassification: webFetch => medium risk, builtin source", () => {
  const result = getRuntimeToolClassification("webFetch");
  assert.equal(result.risk, "medium");
  assert.equal(result.source, "builtin");
});

test("getRuntimeToolClassification: docExtract => medium risk, builtin source", () => {
  const result = getRuntimeToolClassification("docExtract");
  assert.equal(result.risk, "medium");
  assert.equal(result.source, "builtin");
});

test("getRuntimeToolClassification: documentExport => medium risk, builtin source", () => {
  const result = getRuntimeToolClassification("documentExport");
  assert.equal(result.risk, "medium");
  assert.equal(result.source, "builtin");
});

test("getRuntimeToolClassification: imageAnalyze => medium risk, builtin source", () => {
  const result = getRuntimeToolClassification("imageAnalyze");
  assert.deepEqual(result, { risk: "medium", source: "builtin" });
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

// Lock test for which tools reach an approval gate at all: the ApprovalBroker
// only gates risk high/critical.
//
// `bash` is high risk but opts out of the broker inside decideBashToolPolicy
// (always returns `allow`), answering through the Host Bash store instead.
// `extensionManage` is critical and *does* create a broker request, because
// installing an extension downloads and executes third-party code.
//
// That second case is why `SharedRuntimeCommandService` resolves broker requests
// as well as Host Bash records: a broker request that no channel can answer
// would just time out. Adding another high/critical tool means checking that
// same path still works — do not simply add it to the list below.
test("host execution and code installers carry an approval-triggering risk level", () => {
  assert.equal(getRuntimeToolClassification("bash").risk, "high");
  assert.equal(getRuntimeToolClassification("extensionManage").risk, "critical");
  assert.equal(getRuntimeToolClassification("miniAppManage").risk, "critical");
  // Extension-provided tools are medium: honest about not being built-in,
  // without prompting on every call.
  assert.deepEqual(
    getRuntimeToolClassification("someExtensionTool", { isExtensionTool: true }),
    { risk: "medium", source: "plugin" }
  );

  // Mini App tools reach the approval broker only when the manifest declares
  // the tool destructive. A destructive Mini App tool IS an intentional
  // addition to the high-risk set above — it answers through the same broker.
  assert.equal(
    getRuntimeToolClassification("miniapp__todo__remove", {
      miniApp: { readOnlyHint: false, destructiveHint: true }
    }).risk,
    "high"
  );

  for (const name of [
    "read", "write", "edit", "webSearch", "webFetch", "docExtract", "imageAnalyze", "subagent", "attach", "event",
    "memory", "skillSearch", "skillManage", "switchModel", "imageGenerate",
    "ttsGenerate", "videoGenerate", "mcpInvoke", "loadMcp",
    "mcp__server__tool", "anyUnknownToolName",
    // A Mini App tool with no declared hints defaults to medium/plugin.
    "miniapp__notes__add"
  ]) {
    const { risk } = getRuntimeToolClassification(name);
    assert.notEqual(risk, "high", `${name} must not be high risk`);
    assert.notEqual(risk, "critical", `${name} must not be critical risk`);
  }
});
