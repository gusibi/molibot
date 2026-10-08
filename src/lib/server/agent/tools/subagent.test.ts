import "./testDataDir.js";
import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { getPluginConfigStore, resetPluginConfigStoreForTests } from "$lib/server/plugins/contract/configStore.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { currentModelKey } from "$lib/server/settings/modelSwitch.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import {
  buildSubagentModelCandidates,
  buildSubagentCustomCompat,
  buildSubagentPiSettings,
  createSubagentTool,
  isIndependentReviewRoute,
  isSafeReadOnlySubagentCommand,
  listBuiltInSubagents,
  normalizeSubagentStopReason,
  parseSubagentMode,
  renderDelegationBrief,
  resolveSubagentModelRoute,
  summarizeSubagentStopReason,
  summarizeSubagentResultsForParent
} from "$lib/server/agent/tools/subagent.js";

test("custom subagent models declare unsupported developer roles", () => {
  assert.equal(
    buildSubagentCustomCompat(
      { thinkingFormat: undefined },
      { id: "model", tags: [], enabled: true, supportedRoles: ["system", "user", "assistant", "tool"] }
    )?.supportsDeveloperRole,
    false
  );
  assert.equal(
    buildSubagentCustomCompat(
      { thinkingFormat: undefined },
      { id: "model", tags: [], enabled: true, supportedRoles: ["system", "user", "assistant", "tool", "developer"] }
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

test("restricted subagent tool rejects disallowed roles before starting delegated work", async () => {
  const started: string[] = [];
  let delegatedTools: string[] | undefined;
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => defaultRuntimeSettings,
    allowedAgents: ["scout", "planner"],
    excludedTools: ["bash"],
    runSubagent: async (agent: { name: string; tools?: string[] }, task: string) => {
      started.push(agent.name);
      delegatedTools = agent.tools;
      return completed(agent.name, task);
    }
  } as any);

  await assert.rejects(
    tool.execute("tool-1", { agent: "worker", task: "Edit the implementation" }, undefined, undefined),
    /not available.*scout, planner/i
  );
  assert.deepEqual(started, []);

  await tool.execute("tool-2", { agent: "scout", task: "Inspect the implementation" }, undefined, undefined);
  assert.deepEqual(started, ["scout"]);
  assert.deepEqual(delegatedTools, ["read", "grep", "find", "ls"]);
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
    budget: { toolCalls: 24, toolFailures: 0, modelFailures: 0, modelTurns: 1 },
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
    budget: { toolCalls: 1, toolFailures: 0, modelFailures: 0, modelTurns: 1 },
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
    emitRunnerEvent: async (event: Record<string, unknown>) => { events.push(event); },
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

test("listBuiltInSubagents includes external subagents claude-code and codex", () => {
  const subagents = listBuiltInSubagents();
  assert.ok(subagents.some((agent) => agent.name === "claude-code"));
  assert.ok(subagents.some((agent) => agent.name === "codex"));
});

test("createSubagentTool advertises external subagents when plugin is enabled", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-subagent-test-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsConfigDir = path.join(root, "config");
    resetPluginConfigStoreForTests();

    const configStore = getPluginConfigStore();
    await configStore.writeConfig("external-subagent", 1, {
      codexEnabled: true,
      claudeCodeEnabled: true
    });

    const enabledSettings: RuntimeSettings = {
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        entries: {
          "external-subagent": { enabled: true }
        }
      }
    };

    const tool = createSubagentTool({
      cwd: process.cwd(),
      workspaceDir: process.cwd(),
      chatId: "test-chat",
      getSettings: () => enabledSettings
    });

    assert.ok(tool.description.includes("`claude-code`"));
    assert.ok(tool.description.includes("`codex`"));
  } finally {
    resetPluginConfigStoreForTests();
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("createSubagentTool rejects a provider disabled after the tool was created", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-subagent-disabled-provider-test-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsConfigDir = path.join(root, "config");
    resetPluginConfigStoreForTests();

    const configStore = getPluginConfigStore();
    await configStore.writeConfig("external-subagent", 1, {
      codexEnabled: true,
      claudeCodeEnabled: true
    });

    const settings: RuntimeSettings = {
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        entries: {
          "external-subagent": { enabled: true }
        }
      }
    };
    const started: string[] = [];
    const tool = createSubagentTool({
      cwd: process.cwd(),
      workspaceDir: process.cwd(),
      chatId: "test-chat",
      getSettings: () => settings,
      runSubagent: async (agent, task) => {
        started.push(agent.name);
        return completed(agent.name, task) as any;
      }
    });
    assert.match(tool.description, /`claude-code`/);

    await configStore.writeConfig("external-subagent", 1, {
      codexEnabled: true,
      claudeCodeEnabled: false
    });

    await assert.rejects(
      tool.execute("tool-1", { agent: "claude-code", task: "Must not run" }, undefined, undefined),
      /claude-code.*disabled/i
    );
    await assert.rejects(
      tool.execute("tool-2", {
        chain: [
          { agent: "scout", task: "Inspect" },
          { agent: "claude-code", task: "Must not run after {previous}" }
        ]
      }, undefined, undefined),
      /claude-code.*disabled/i
    );

    await configStore.writeConfig("external-subagent", 1, {
      codexEnabled: false,
      claudeCodeEnabled: true
    });
    await assert.rejects(
      tool.execute("tool-3", {
        tasks: [
          { agent: "scout", task: "Inspect" },
          { agent: "codex", task: "Must not run in parallel" }
        ]
      }, undefined, undefined),
      /codex.*disabled/i
    );
    assert.deepEqual(started, []);
  } finally {
    resetPluginConfigStoreForTests();
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native child tools come from the shared runtime permission boundary", () => {
  const source = fs.readFileSync(path.resolve("src/lib/server/agent/tools/index.ts"), "utf8");
  assert.match(source, /getChildTools = \(\) => \[readToolDef, bashToolDef, editToolDef, writeToolDef\]\.map\(toAgentTool\)/);
});

test("standalone skill drafter runs in a native owner and keeps a readable public transcript", { timeout: 10000 }, async () => {
  const { runBuiltInSubagentTask } = await import("./subagent.js");
  const { getPiModels } = await import("$lib/server/providers/piRuntime.js");
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const workspace = mkdtempSync(join(tmpdir(), "molibot-native-drafter-"));
  const provider = "native-drafter-fixture";
  const settings: RuntimeSettings = { ...defaultRuntimeSettings, providerMode: "custom", defaultCustomProviderId: provider,
    modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: `custom|${provider}|fixture`, subagentModelKey: `custom|${provider}|fixture` },
    subagentRuntime: { ...defaultRuntimeSettings.subagentRuntime, persistSessions: true },
    customProviders: [{ id: provider, name: "Fixture", enabled: true, protocol: "openai-compatible", baseUrl: "https://fixture.invalid/v1",
      apiKey: "fixture-key", path: "/chat/completions", defaultModel: "fixture", models: [{ id: "fixture", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }] }] };
  const { resolveModelSelection } = await import("$lib/server/agent/routing/modelRouting.js");
  const model = resolveModelSelection(settings).model;
  let requests = 0;
  const stream = () => {
    requests++;
    const output = createAssistantMessageEventStream();
    output.push({ type: "done", reason: "stop", message: { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: "Draft completed" }], timestamp: Date.now(), stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
    output.end(); return output;
  };
  getPiModels().setProvider({ id: provider, name: "Fixture", getModels: () => [model],
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture-key" } }) } }, stream, streamSimple: stream });
  const budgets: string[] = [];
  try {
    const result = await runBuiltInSubagentTask({ agent: "skill-drafter", task: "Draft a skill", cwd: workspace, workspaceDir: workspace,
      chatId: "fixture", settings, childTools: () => [], beforeGeneration: id => budgets.push(id) });
    assert.equal(result.stopReason, "stop", result.errorMessage); assert.equal(requests, 1);
    assert.equal(budgets.length, 1); assert.match(budgets[0], /:child:/); assert.equal(result.usage.total, 2);
    const transcript = SessionManager.open(join(workspace, "subagent-sessions", `${result.sessionId}.jsonl`));
    assert.equal(transcript.getSessionId(), result.sessionId);
    assert.match(JSON.stringify(transcript.buildSessionContext().messages), /Draft completed/);
  } finally { getPiModels().deleteProvider(provider); rmSync(workspace, { recursive: true, force: true }); }
});

test("stopped child returns an error receipt with progress and a parent reporting obligation", async () => {
  const tool = createSubagentTool({ cwd: process.cwd(), workspaceDir: process.cwd(), chatId: "report-child",
    getSettings: () => defaultRuntimeSettings,
    runSubagent: async (agent: { name: string }, task: string) => ({ ...budgetStopped(agent.name, task),
      output: "Created source.md; validation pending", errorMessage: "Model failed after 12 retries" }) } as any);
  const result = await tool.execute("report", { agent: "worker", task: "Write and validate" }, undefined, undefined);
  assert.equal(result.isError, true);
  const text = JSON.stringify(result.content);
  assert.match(text, /Model failed after 12 retries/);
  assert.match(text, /Created source.md/);
  assert.match(text, /not completed/i);
  assert.match(text, /final.*status/i);
});

test("renderDelegationBrief emits only the supplied fields and leaves a plain task unchanged", () => {
  assert.equal(renderDelegationBrief({ agent: "scout", task: "Inspect" }, "Inspect"), "Inspect");

  const rendered = renderDelegationBrief({
    agent: "worker",
    task: "Write the article",
    goal: "Draft the bilingual post",
    knownSources: ["docs/outline.md", "assets/img1.png"],
    missingInfo: ["the publish URL"],
    constraints: ["Simplified Chinese + English"],
    deliverables: ["post.md"],
    acceptance: ["both languages present"]
  }, "Write the article");

  assert.match(rendered, /## Delegation brief/);
  assert.match(rendered, /Goal: Draft the bilingual post/);
  assert.match(rendered, /docs\/outline\.md/);
  assert.match(rendered, /the publish URL/);
  assert.match(rendered, /Simplified Chinese \+ English/);
  assert.match(rendered, /post\.md/);
  assert.match(rendered, /both languages present/);
  assert.match(rendered, /## Task\nWrite the article$/);
  // A handoff is a brief, not a dump of the parent's own conversation.
  assert.doesNotMatch(rendered, /previous conversation|parent transcript/i);
});

test("a structured task brief reaches the delegated child", async () => {
  const seen: string[] = [];
  const tool = createSubagentTool({
    cwd: process.cwd(),
    workspaceDir: process.cwd(),
    chatId: "chat-1",
    getSettings: () => defaultRuntimeSettings,
    runSubagent: async (agent: { name: string }, task: string) => {
      seen.push(task);
      return completed(agent.name, task);
    }
  } as any);

  await tool.execute("tool-1", {
    tasks: [{
      agent: "scout",
      task: "Find the config loader",
      knownSources: ["src/config.ts"],
      missingInfo: ["the default path"],
      acceptance: ["cite the file"]
    }]
  }, undefined, undefined);

  assert.equal(seen.length, 1);
  assert.match(seen[0], /Known sources/);
  assert.match(seen[0], /src\/config\.ts/);
  assert.match(seen[0], /Missing information/);
  assert.match(seen[0], /Acceptance criteria/);
  assert.match(seen[0], /Find the config loader/);
});

test("parseSubagentMode preserves the structured task brief", () => {
  const parsed = parseSubagentMode({
    tasks: [{
      agent: "worker",
      task: "Draft",
      goal: "G",
      knownSources: ["a.ts"],
      constraints: ["c"],
      acceptance: ["done"]
    }]
  }, MODE_LIMITS);

  assert.deepEqual(parsed.tasks[0], {
    agent: "worker",
    task: "Draft",
    goal: "G",
    knownSources: ["a.ts"],
    constraints: ["c"],
    acceptance: ["done"]
  });
});

test("single-task delegation preserves the brief in the schema and child request", async () => {
  const seen: string[] = [];
  const tool = createSubagentTool({
    cwd: process.cwd(), workspaceDir: process.cwd(), chatId: "single-brief",
    getSettings: () => defaultRuntimeSettings,
    runSubagent: async (agent: { name: string }, task: string) => {
      seen.push(task);
      return completed(agent.name, task);
    }
  } as any);
  const input = { agent: "worker", task: "Draft", goal: "Bilingual post",
    knownSources: ["outline.md"], constraints: ["Chinese and English"], acceptance: ["Both languages present"] };
  for (const field of ["goal", "knownSources", "constraints", "acceptance"]) {
    assert.ok(field in tool.parameters.properties, `${field} must be model-visible in single mode`);
  }
  assert.deepEqual(parseSubagentMode(input, MODE_LIMITS).tasks, [input]);
  const result = await tool.execute("single-brief", input, undefined, undefined);
  assert.equal(result.isError, false);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Bilingual post/);
  assert.match(seen[0], /outline\.md/);
  assert.match(seen[0], /Chinese and English/);
  assert.match(seen[0], /Both languages present/);
});
