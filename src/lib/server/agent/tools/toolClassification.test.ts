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
