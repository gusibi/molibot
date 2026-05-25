import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "../../settings/defaults.js";
import {
  createSubagentTool,
  isSafeReadOnlySubagentCommand,
  listBuiltInSubagents,
  normalizeSubagentStopReason,
  resolveSubagentModelRoute,
  summarizeSubagentStopReason,
  summarizeSubagentResultsForParent
} from "./subagent.js";

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
  assert.equal(subagents.find((agent) => agent.name === "skill-drafter")?.modelLevel, "haiku");
  assert.equal(subagents.some((agent) => String(agent.modelHint ?? "").startsWith("claude-")), false);
});

test("subagent model route overrides model level fallback", () => {
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "openai" as const,
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
    piModelProvider: "openai" as const,
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

test("subagent emits a terminal error event when execution fails before producing results", async () => {
  const events: Array<Record<string, unknown>> = [];
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => defaultRuntimeSettings,
    emitRunnerEvent: async (event) => {
      events.push(event as unknown as Record<string, unknown>);
    }
  });

  await assert.rejects(
    tool.execute("tool-1", {
      agent: "missing-agent",
      task: "Inspect the patch"
    }, undefined, undefined),
    /Unknown subagent/
  );

  assert.deepEqual(
    events.map((event) => ({ phase: event.phase, stopReason: event.stopReason })),
    [
      { phase: "start", stopReason: undefined },
      { phase: "end", stopReason: "error" }
    ]
  );
});

test("subagent result summary compresses long child output for parent context", () => {
  const output = `${"a".repeat(5000)}\nIMPORTANT\n${"z".repeat(2500)}`;
  const summary = summarizeSubagentResultsForParent("single", [{
    agent: "scout",
    task: "inspect",
    output,
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      cost: 0,
      turns: 0
    }
  }]);

  assert.ok(summary.length < output.length);
  assert.match(summary, /subagent output compressed for parent context/);
  assert.match(summary, /^aaaa/);
  assert.match(summary, /zzzz$/);
});

test("subagent stop reason preserves waiting_for_approval", () => {
  assert.equal(normalizeSubagentStopReason("waiting_for_approval"), "waiting_for_approval");
  assert.equal(
    summarizeSubagentStopReason([
      { stopReason: "stop" },
      { stopReason: "waiting_for_approval" }
    ]),
    "waiting_for_approval"
  );
  assert.equal(
    summarizeSubagentStopReason([
      { stopReason: "waiting_for_approval" },
      { stopReason: "error" }
    ]),
    "error"
  );
});
