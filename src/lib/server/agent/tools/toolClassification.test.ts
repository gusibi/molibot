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
  const extension = getRuntimeToolClassification("someExtensionTool", { isExtensionTool: true });
  assert.equal(extension.risk, "medium");
  assert.equal(extension.source, "plugin");

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

/**
 * The effect dimension (Permission Modes PRD §87).
 *
 * `risk` cannot express the gate: `write`(medium) sits beside `webSearch`
 * (medium), and `bash`(high) beside `miniapp__x.delete`(high), so "auto-approve
 * file writes but keep asking before running commands" is unsayable on the risk
 * axis. `effect` is what a permission mode is written against; `risk` keeps
 * only its display and audit duty.
 */

test("effect: local readers are read, remote readers are network", () => {
  for (const name of ["read", "ls", "grep", "docExtract", "imageAnalyze"]) {
    assert.equal(getRuntimeToolClassification(name).effect, "read", name);
  }
  // Reaching the network is its own effect: it leaves the machine, so a mode
  // may want to gate it even though it only reads.
  for (const name of ["webSearch", "webFetch"]) {
    assert.equal(getRuntimeToolClassification(name).effect, "network", name);
  }
});

test("effect: write and edit are write, bash is execute", () => {
  assert.equal(getRuntimeToolClassification("write").effect, "write");
  assert.equal(getRuntimeToolClassification("edit").effect, "write");
  assert.equal(getRuntimeToolClassification("bash").effect, "execute");
});

test("effect: install tools are manage, which no mode may auto-allow", () => {
  assert.equal(getRuntimeToolClassification("extensionManage").effect, "manage");
  assert.equal(getRuntimeToolClassification("miniAppManage").effect, "manage");
});

test("effect: Mini App and pi extension tools are installed_app, not third_party", () => {
  // The owner installed them, and that install went through `manage`. An
  // external MCP server is a *connection*, not installed code, so the two are
  // trusted differently (decision 2026-08-10).
  assert.equal(
    getRuntimeToolClassification("miniapp__todo__add", { miniApp: { readOnlyHint: false, destructiveHint: false } }).effect,
    "installed_app"
  );
  assert.equal(getRuntimeToolClassification("some_ext_tool", { isExtensionTool: true }).effect, "installed_app");
  assert.equal(getRuntimeToolClassification("mcp__srv__tool").effect, "third_party");
});

test("effect: MCP tools are third_party, and their annotation is carried, not guessed", () => {
  // Decision 3 (2026-08-10): a server-declared `readOnlyHint` may relax the
  // call, but only in Auto, and only when it is actually declared.
  const undeclared = getRuntimeToolClassification("mcp__srv__query");
  assert.equal(undeclared.effect, "third_party");
  assert.equal(undeclared.thirdPartyHint, "undeclared", "a missing annotation is never read as read-only");

  const readOnly = getRuntimeToolClassification("mcp__srv__query", {
    mcp: { readOnlyHint: true, destructiveHint: false }
  });
  assert.equal(readOnly.thirdPartyHint, "read_only");

  const destructive = getRuntimeToolClassification("mcp__srv__drop", {
    mcp: { readOnlyHint: false, destructiveHint: true }
  });
  assert.equal(destructive.thirdPartyHint, "destructive");

  // destructiveHint always wins over a contradictory readOnlyHint.
  const both = getRuntimeToolClassification("mcp__srv__weird", {
    mcp: { readOnlyHint: true, destructiveHint: true }
  });
  assert.equal(both.thirdPartyHint, "destructive", "destructiveHint outranks readOnlyHint");
});

test("effect: a Mini App manifest hint maps the same way as an MCP annotation", () => {
  assert.equal(
    getRuntimeToolClassification("miniapp__a__b", { miniApp: { readOnlyHint: true, destructiveHint: false } }).thirdPartyHint,
    "read_only"
  );
  assert.equal(
    getRuntimeToolClassification("miniapp__a__b", { miniApp: { readOnlyHint: false, destructiveHint: true } }).thirdPartyHint,
    "destructive"
  );
});

test("effect: risk is unchanged by the new dimension", () => {
  // The two axes are independent; adding effect must not move any risk value.
  assert.equal(getRuntimeToolClassification("bash").risk, "high");
  assert.equal(getRuntimeToolClassification("write").risk, "medium");
  assert.equal(getRuntimeToolClassification("extensionManage").risk, "critical");
  assert.equal(getRuntimeToolClassification("read").risk, "low");
});
