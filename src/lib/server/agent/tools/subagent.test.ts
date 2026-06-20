import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { currentModelKey } from "$lib/server/settings/modelSwitch.js";
import {
  buildSubagentModelCandidates,
  createSubagentTool,
  isSafeReadOnlySubagentCommand,
  listBuiltInSubagents,
  normalizeSubagentStopReason,
  resolveSubagentModelRoute,
  summarizeSubagentStopReason,
  summarizeSubagentResultsForParent
} from "$lib/server/agent/tools/subagent.js";

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

test("subagent model candidates list the resolved primary route first, then a distinct text-route fallback", () => {
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "openai" as const,
    piModelName: "gpt-4.1-mini",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      subagentSonnetModelKey: "pi|deepseek|deepseek-v4-flash"
    }
  };

  const candidates = buildSubagentModelCandidates(settings, "sonnet");
  // The first candidate must match what the single-route resolver returns today.
  assert.deepEqual(candidates[0], resolveSubagentModelRoute(settings, "sonnet"));
  assert.deepEqual(candidates[0], { mode: "pi", provider: "deepseek", model: "deepseek-v4-flash" });
  // A fallback (the main text route) must follow so a failed primary can recover.
  const textRoute = currentModelKey(settings, "text");
  assert.ok(candidates.length >= 2);
  assert.ok(candidates.some((c) => `${c.mode}|${c.provider}|${c.model}` === textRoute));
});

test("subagent model candidates de-duplicate identical routes", () => {
  const settings = {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      subagentModelKey: currentModelKey(defaultRuntimeSettings, "text")
    }
  };

  const candidates = buildSubagentModelCandidates(settings, undefined);
  const keys = candidates.map((c) => `${c.mode}|${c.provider}|${c.model}`);
  assert.equal(keys.length, new Set(keys).size);
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

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, turns: 0 };

function budgetStopped(agentName: string, task: string) {
  return {
    agent: agentName,
    task,
    output: "partial work before the budget ran out",
    stopReason: "error",
    errorMessage: "Run budget exceeded: too many tool calls (24/24).",
    usage: ZERO_USAGE,
    model: "fake-model",
    budget: { toolCalls: 24, toolFailures: 0, modelAttempts: 1 },
    runtimeStopKind: "budget_exceeded" as const,
    durationMs: 5
  };
}

function completed(agentName: string, task: string) {
  return {
    agent: agentName,
    task,
    output: `done: ${task}`,
    stopReason: "stop",
    usage: ZERO_USAGE,
    model: "fake-model",
    budget: { toolCalls: 1, toolFailures: 0, modelAttempts: 1 },
    durationMs: 3
  };
}

test("single mode surfaces a budget-stopped subagent result and a terminal error end event", async () => {
  const events: Array<Record<string, unknown>> = [];
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => defaultRuntimeSettings,
    emitRunnerEvent: async (event) => { events.push(event as Record<string, unknown>); },
    runSubagent: async (agent: { name: string }, task: string) => budgetStopped(agent.name, task)
  } as any);

  const result = await tool.execute("tool-1", { agent: "scout", task: "inspect everything" }, undefined, undefined);
  const details = (result as any).details;
  assert.equal(details.results.length, 1);
  assert.equal(details.results[0].runtimeStopKind, "budget_exceeded");
  assert.equal(events.find((e) => e.phase === "end")?.stopReason, "error");
});

test("parallel mode runs every task even when one is budget-stopped", async () => {
  const seen: string[] = [];
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => defaultRuntimeSettings,
    runSubagent: async (agent: { name: string }, task: string) => {
      seen.push(task);
      return task === "b" ? budgetStopped(agent.name, task) : completed(agent.name, task);
    }
  } as any);

  const result = await tool.execute(
    "tool-1",
    { tasks: [{ agent: "scout", task: "a" }, { agent: "scout", task: "b" }, { agent: "scout", task: "c" }], maxConcurrency: 3 },
    undefined,
    undefined
  );

  assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
  assert.equal((result as any).details.results.length, 3);
});

test("chain mode stops after a budget-stopped step instead of running the rest", async () => {
  const seen: string[] = [];
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => defaultRuntimeSettings,
    runSubagent: async (agent: { name: string }, task: string) => {
      seen.push(task);
      return task === "step1" ? budgetStopped(agent.name, task) : completed(agent.name, task);
    }
  } as any);

  const result = await tool.execute(
    "tool-1",
    { chain: [{ agent: "scout", task: "step1" }, { agent: "worker", task: "step2" }] },
    undefined,
    undefined
  );

  assert.deepEqual(seen, ["step1"]);
  assert.equal((result as any).details.results.length, 1);
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

test("createSubagentTool requestedByDepth is incremented and propagated to hostApproval", async () => {
  let capturedHostApproval: any = null;
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    channel: "telegram",
    sessionId: "session-1",
    store: {} as any,
    getSettings: () => defaultRuntimeSettings,
    requestedByDepth: 2,
    _testHostApprovalCallback: (hostApproval: any) => {
      capturedHostApproval = hostApproval;
      throw new Error("test-depth-success");
    }
  } as any);

  await assert.rejects(
    tool.execute("tool-1", {
      agent: "scout",
      task: "Inspect the patch"
    }, undefined, undefined),
    /test-depth-success/
  );

  assert.ok(capturedHostApproval);
  assert.equal(capturedHostApproval.requestedByDepth, 3);
});
