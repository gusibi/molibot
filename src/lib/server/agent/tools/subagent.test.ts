import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "../../settings/defaults.js";
import { isSafeReadOnlySubagentCommand, listBuiltInSubagents, resolveSubagentModelRoute } from "./subagent.js";

test("read-only subagent bash rejects shell control operators", () => {
  assert.equal(isSafeReadOnlySubagentCommand("git diff -- src/lib/server/agent/runner.ts"), true);
  assert.equal(isSafeReadOnlySubagentCommand("rg subagent src/lib/server"), true);
  assert.equal(isSafeReadOnlySubagentCommand("git diff && rm -rf src"), false);
  assert.equal(isSafeReadOnlySubagentCommand("rg subagent src/lib/server; git checkout -- ."), false);
});

test("checked-in subagents use model levels instead of concrete Claude models", () => {
  const subagents = listBuiltInSubagents();
  assert.equal(subagents.find((agent) => agent.name === "scout")?.modelLevel, "haiku");
  assert.equal(subagents.find((agent) => agent.name === "planner")?.modelLevel, "sonnet");
  assert.equal(subagents.some((agent) => String(agent.modelHint ?? "").startsWith("claude-")), false);
});

test("subagent model route overrides model level fallback", () => {
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "openai",
    piModelName: "gpt-4.1-mini",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      subagentModelKey: "pi|google|gemini-flash-latest"
    }
  };

  assert.deepEqual(resolveSubagentModelRoute(settings, "claude-sonnet-4-5"), {
    mode: "pi",
    provider: "google",
    model: "gemini-flash-latest"
  });
});

test("subagent model level route overrides generic subagent route", () => {
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "openai",
    piModelName: "gpt-4.1-mini",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      subagentModelKey: "pi|google|gemini-flash-latest",
      subagentSonnetModelKey: "pi|deepseek|deepseek-v4-flash"
    }
  };

  assert.deepEqual(resolveSubagentModelRoute(settings, "sonnet"), {
    mode: "pi",
    provider: "deepseek",
    model: "deepseek-v4-flash"
  });
});
