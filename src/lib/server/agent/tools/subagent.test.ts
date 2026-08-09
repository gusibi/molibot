import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { currentModelKey } from "$lib/server/settings/modelSwitch.js";
import {
  buildSubagentModelCandidates,
  buildSubagentCustomCompat,
  buildSubagentPiSettings,
  createSubagentSessionManager,
  createSubagentTool,
  isIndependentReviewRoute,
  isSafeReadOnlySubagentCommand,
  listBuiltInSubagents,
  normalizeSubagentStopReason,
  parseSubagentMode,
  resolveSubagentModelRoute,
  summarizeSubagentStopReason,
  summarizeSubagentResultsForParent
} from "$lib/server/agent/tools/subagent.js";

test("custom subagent models declare unsupported developer roles", () => {
  assert.equal(
    buildSubagentCustomCompat(
      { thinkingFormat: undefined },
      { id: "model", supportedRoles: ["system", "user", "assistant", "tool"] }
    )?.supportsDeveloperRole,
    false
  );
  assert.equal(
    buildSubagentCustomCompat(
      { thinkingFormat: undefined },
      { id: "model", supportedRoles: ["system", "user", "assistant", "tool", "developer"] }
    )?.supportsDeveloperRole,
    true
  );
});

test("Subagent pi settings inherit bounded compaction values from runtime settings", () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.compaction.reserveTokens = 20_000;
  settings.compaction.keepRecentTokens = 30_000;
  settings.subagentRuntime.compactionEnabled = true;

  assert.deepEqual(buildSubagentPiSettings(settings), {
    compaction: {
      enabled: true,
      reserveTokens: 20_000,
      keepRecentTokens: 30_000
    }
  });
});

test("Subagent session manager persists under the workspace only when enabled", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-subagent-session-"));
  try {
    const persistedSettings = structuredClone(defaultRuntimeSettings);
    persistedSettings.subagentRuntime.persistSessions = true;
    const persisted = createSubagentSessionManager({
      cwd: workspaceDir,
      workspaceDir,
      settings: persistedSettings,
      sessionId: "run-1-worker"
    });
    assert.equal(persisted.isPersisted(), true);
    assert.equal(persisted.getSessionId(), "run-1-worker");
    assert.equal(persisted.getSessionDir(), join(workspaceDir, "subagent-sessions"));

    const memorySettings = structuredClone(defaultRuntimeSettings);
    memorySettings.subagentRuntime.persistSessions = false;
    const memory = createSubagentSessionManager({
      cwd: workspaceDir,
      workspaceDir,
      settings: memorySettings,
      sessionId: "run-2-scout"
    });
    assert.equal(memory.isPersisted(), false);
    assert.equal(memory.getSessionId(), "run-2-scout");
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

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

test("the reviewer declares that it needs a model independent of the parent run", () => {
  const reviewer = listBuiltInSubagents().find((agent) => agent.name === "reviewer");
  assert.equal(reviewer?.independentReview, true);
  // Independence is a reviewer-only requirement; the others must stay on the
  // cheapest route that fits their level.
  assert.equal(listBuiltInSubagents().filter((agent) => agent.independentReview).length, 1);
});

test("an independent reviewer prefers a candidate outside the parent model family", () => {
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "anthropic" as const,
    piModelName: "claude-sonnet-4-5",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      // The level route the reviewer asks for happens to be the parent family.
      subagentSonnetModelKey: "pi|anthropic|claude-sonnet-4-5",
      subagentModelKey: "pi|deepseek|deepseek-v4-flash"
    }
  };

  const ordinary = buildSubagentModelCandidates(settings, "sonnet");
  assert.deepEqual(ordinary[0], { mode: "pi", provider: "anthropic", model: "claude-sonnet-4-5" });

  const review = buildSubagentModelCandidates(settings, "sonnet", { independentReview: true });
  assert.deepEqual(
    review[0],
    { mode: "pi", provider: "deepseek", model: "deepseek-v4-flash" },
    "a reviewer on the author's own model family cannot claim independent review"
  );
  // Same-family routes are demoted, never dropped: a reviewer on the same model
  // is still useful, so losing the capability would be the worse trade.
  assert.ok(review.some((route) => route.provider === "anthropic" && route.model === "claude-sonnet-4-5"));
  assert.equal(review.length, ordinary.length);
});

test("a reviewer keeps its configured route when every candidate shares the parent family", () => {
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "anthropic" as const,
    piModelName: "claude-sonnet-4-5",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      subagentSonnetModelKey: "pi|anthropic|claude-opus-4-1",
      subagentModelKey: "pi|anthropic|claude-haiku-4-5"
    }
  };

  const review = buildSubagentModelCandidates(settings, "sonnet", { independentReview: true });
  assert.deepEqual(review[0], { mode: "pi", provider: "anthropic", model: "claude-opus-4-1" });
  assert.equal(isIndependentReviewRoute(settings, review[0]!), false);
});

test("independence is judged by model lineage, so a proxy of the parent family does not count", () => {
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "anthropic" as const,
    piModelName: "claude-sonnet-4-5"
  };

  assert.equal(
    isIndependentReviewRoute(settings, { provider: "my-proxy", model: "claude-sonnet-4-5" }),
    false
  );
  assert.equal(
    isIndependentReviewRoute(settings, { provider: "deepseek", model: "deepseek-v4-flash" }),
    true
  );
});

test("a reviewer that had to run on the parent model family says so in its result", () => {
  const base = {
    agent: "reviewer" as const,
    task: "Review the patch",
    stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, turns: 1 }
  };

  const degraded = summarizeSubagentResultsForParent("single", [
    { ...base, output: "## Summary\nLooks fine.", model: "claude-opus-4-1", reviewIndependence: "same-family" }
  ]);
  // The parent must be able to discount the review, so the caveat has to reach
  // the parent context — a log line alone would be invisible to it.
  assert.match(degraded, /same model family/i);
  assert.match(degraded, /Looks fine\./);

  const independent = summarizeSubagentResultsForParent("single", [
    { ...base, output: "## Summary\nLooks fine.", model: "deepseek-v4-flash", reviewIndependence: "independent" }
  ]);
  assert.doesNotMatch(independent, /same model family/i);
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

test("parallel mode rejects task fan-out above the configured maximum before starting work", async () => {
  let started = 0;
  const settings = structuredClone(defaultRuntimeSettings);
  settings.subagentRuntime.maxTasks = 2;
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => settings,
    runSubagent: async (agent: { name: string }, task: string) => {
      started += 1;
      return completed(agent.name, task);
    }
  } as any);

  await assert.rejects(
    tool.execute("tool-1", {
      tasks: [
        { agent: "scout", task: "a" },
        { agent: "scout", task: "b" },
        { agent: "scout", task: "c" }
      ]
    }, undefined, undefined),
    /task limit exceeded.*requested 3.*maximum 2/i
  );
  assert.equal(started, 0);
});

test("parallel mode caps requested concurrency at the configured maximum", async () => {
  let active = 0;
  let peak = 0;
  const settings = structuredClone(defaultRuntimeSettings);
  settings.subagentRuntime = {
    ...settings.subagentRuntime,
    maxTasks: 4,
    maxConcurrency: 2
  };
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => settings,
    runSubagent: async (agent: { name: string }, task: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return completed(agent.name, task);
    }
  } as any);

  await tool.execute("tool-1", {
    tasks: [
      { agent: "scout", task: "a" },
      { agent: "scout", task: "b" },
      { agent: "scout", task: "c" },
      { agent: "scout", task: "d" }
    ],
    maxConcurrency: 4
  }, undefined, undefined);

  assert.equal(peak, 2);
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

const MODE_LIMITS = { maxTasks: 8, maxConcurrency: 4 };

// A model that restates one task as both {agent, task} and a one-element
// {tasks} has not asked for anything ambiguous. Rejecting it burned two tool
// failures per turn (the call was emitted twice in parallel) and that is what
// pushed a real run into the failure budget and killed it mid-flight.
test("parseSubagentMode collapses redundant modes that describe identical work", () => {
  const single = { agent: "scout", task: "Explore the miniapp" };
  const collapsed = parseSubagentMode({ ...single, tasks: [single] }, MODE_LIMITS);
  assert.equal(collapsed.mode, "parallel");
  assert.deepEqual(collapsed.tasks, [single]);

  const chained = parseSubagentMode({ ...single, chain: [single] }, MODE_LIMITS);
  assert.equal(chained.mode, "chain");
  assert.deepEqual(chained.tasks, [single]);
});

test("parseSubagentMode still refuses genuinely ambiguous mode combinations", () => {
  const a = { agent: "scout", task: "Explore" };
  const b = { agent: "planner", task: "Design" };
  // Different work in each shape — we would have to guess which one to run.
  assert.throws(
    () => parseSubagentMode({ agent: a.agent, task: a.task, tasks: [b] }, MODE_LIMITS),
    /Conflicting subagent modes/
  );
  // Same list, but concurrent and sequential are different instructions once
  // there is more than one task.
  assert.throws(
    () => parseSubagentMode({ tasks: [a, b], chain: [a, b] }, MODE_LIMITS),
    /Conflicting subagent modes/
  );
  assert.throws(() => parseSubagentMode({}, MODE_LIMITS), /Provide exactly one subagent mode/);
});
