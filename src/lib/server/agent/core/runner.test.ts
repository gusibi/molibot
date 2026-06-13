import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyAssistantStreamEvent } from "$lib/server/agent/core/assistantStream.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { MomRunner } from "$lib/server/agent/core/runner.js";
import { resolveModelSelection } from "$lib/server/agent/routing/modelRouting.js";
import { decideVisionRouting } from "$lib/server/agent/routing/mediaFallback.js";

function createRunnerTestSettings(): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    providerMode: "custom",
    defaultCustomProviderId: "runner-test",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|runner-test|fake-model"
    },
    customProviders: [
      {
        id: "runner-test",
        name: "Runner Test",
        enabled: true,
        protocol: "openai-compatible",
        baseUrl: "https://example.invalid/v1",
        apiKey: "test-key",
        path: "/chat/completions",
        defaultModel: "fake-model",
        models: [
          {
            id: "fake-model",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ]
  };
}

function createRunnerTestMemory() {
  return {
    syncExternalMemories: async () => {},
    createPromptSnapshot: async () => ({
      createdAt: new Date().toISOString(),
      fingerprint: "test",
      query: "hello",
      promptText: "(memory)",
      selected: [],
      longTerm: [],
      daily: []
    })
  };
}

function createRunnerContext(text: string) {
  return {
    channel: "telegram",
    workspaceDir: process.cwd(),
    chatDir: process.cwd(),
    message: {
      chatId: "chat-1",
      chatType: "private",
      messageId: Date.now(),
      userId: "user-1",
      text,
      ts: new Date().toISOString(),
      attachments: [],
      imageContents: []
    },
    respond: async () => {},
    replaceMessage: async () => {},
    respondInThread: async () => {},
    setTyping: async () => {},
    setWorking: async () => {},
    deleteMessage: async () => {},
    uploadFile: async () => {}
  } as any;
}

function createRunnerHookManager(
  events: Array<{ stage: string; payload: any }>,
  gate: () => any = () => ({ type: "allow" })
) {
  return {
    register: () => {},
    unregister: () => false,
    list: () => [],
    registerPlugin: async () => {},
    unregisterPlugin: async () => false,
    emit: (stage: string, _context: unknown, payload: any) => {
      events.push({ stage, payload });
    },
    flush: async () => {},
    transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
    gate: async () => gate()
  } as any;
}

async function createRunnerForHookTest(options: {
  chatId: string;
  workspaceDir?: string;
  hookManager: any;
}) {
  const { MomRuntimeStore } = await import("$lib/server/agent/session/store.js");
  return new MomRunner(
    "telegram",
    options.chatId,
    `session-${options.chatId}-${Date.now()}`,
    new MomRuntimeStore(options.workspaceDir ?? process.cwd()),
    createRunnerTestSettings,
    (patch: Partial<RuntimeSettings>) => ({ ...createRunnerTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any,
    options.hookManager
  );
}

function activateHookContext(runner: MomRunner, runId: string, chatId: string): void {
  (runner as any).activeHookContext = {
    runId,
    channel: "telegram",
    chatId,
    sessionId: `session-${chatId}`
  };
}

function setActiveSkill(runner: MomRunner, filePath: string): void {
  (runner as any).setActiveRunSkillManifestForTest([
    {
      name: "example-skill",
      description: "Example skill",
      scope: "bot",
      filePath,
      baseDir: filePath.replace(/\/SKILL\.md$/i, ""),
      mcpServers: [],
      aliases: []
    }
  ]);
}

function readToolCall(id: string, path: string) {
  return {
    toolCall: { id, name: "read", input: {} },
    args: { path, label: "Read skill" },
    assistantMessage: { role: "assistant", content: [], timestamp: Date.now() },
    context: { systemPrompt: "", messages: [], tools: [] }
  };
}

test("applyAssistantStreamEvent resets buffered assistant text on a new assistant message", () => {
  const afterDelta = applyAssistantStreamEvent(
    { assistantTextStreamed: false, streamedAssistantText: "" },
    { type: "text_delta", delta: "partial answer" }
  );
  assert.equal(afterDelta.assistantTextStreamed, true);
  assert.equal(afterDelta.streamedAssistantText, "partial answer");

  const afterRestart = applyAssistantStreamEvent(afterDelta, {
    type: "message_start",
    role: "assistant"
  });
  assert.deepEqual(afterRestart, {
    assistantTextStreamed: false,
    streamedAssistantText: ""
  });
});

test("decideVisionRouting prefers an explicit dedicated vision route over a vision-capable text route", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5-pro",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "anthropic" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/messages",
        defaultModel: "mimo-v2.5-pro",
        models: [
          {
            id: "mimo-v2.5-pro",
            tags: ["text", "vision"],
            verification: { vision: "passed" },
            supportedRoles: ["system", "user", "assistant"]
          },
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            verification: { vision: "passed" },
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const decision = decideVisionRouting(settings, true);

  assert.equal(decision.mode, "vision");
  assert.equal(decision.selection.modelId, "mimo-v2.5");
  assert.equal(decision.sendImagesNatively, true);
});

test("decideVisionRouting keeps the text route when the vision route resolves to the same model", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "anthropic" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/messages",
        defaultModel: "mimo-v2.5",
        models: [
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            verification: { vision: "passed" },
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const decision = decideVisionRouting(settings, true);

  assert.equal(decision.mode, "text");
  assert.equal(decision.selection.modelId, "mimo-v2.5");
  assert.equal(decision.sendImagesNatively, true);
});

test("decideVisionRouting does not send custom images natively before vision verification passes", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5-pro",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "anthropic" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/messages",
        defaultModel: "mimo-v2.5-pro",
        models: [
          {
            id: "mimo-v2.5-pro",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant"]
          },
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const decision = decideVisionRouting(settings, true);

  assert.equal(decision.mode, "fallback");
  assert.equal(decision.selection.modelId, "mimo-v2.5-pro");
  assert.equal(decision.sendImagesNatively, false);
});

test("custom vision models advertise image input only after vision verification passes", () => {
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "custom-vision",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|custom-vision|mimo-v2.5",
      visionModelKey: "custom|custom-vision|mimo-v2.5"
    },
    customProviders: [
      {
        id: "custom-vision",
        name: "Custom Vision",
        enabled: true,
        protocol: "openai-compatible" as const,
        baseUrl: "https://example.invalid",
        apiKey: "test-key",
        path: "/v1/chat/completions",
        defaultModel: "mimo-v2.5",
        models: [
          {
            id: "mimo-v2.5",
            tags: ["text", "vision"],
            supportedRoles: ["system", "user", "assistant"]
          }
        ]
      }
    ]
  };

  const unverified = resolveModelSelection(settings, "vision");
  assert.deepEqual(unverified.model.input, ["text"]);

  settings.customProviders[0].models[0].verification = { vision: "passed" };
  const verified = resolveModelSelection(settings, "vision");
  assert.deepEqual(verified.model.input, ["text", "image"]);
});

test("manual compact reloads the latest persisted session before summarizing", async () => {
  const largeUserMessage = {
    role: "user",
    content: [{ type: "text", text: "A".repeat(12000) }],
    timestamp: Date.now() - 1000
  } as const;
  const latestAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    timestamp: Date.now()
  } as const;

  const persistedMessages = [largeUserMessage, latestAssistantMessage];
  const appended: Array<{ summary: string; summarizedMessages: number; keptMessages: number }> = [];

  const store = {
    getWorkspaceDir: () => process.cwd(),
    getScratchDir: () => process.cwd(),
    loadContext: () => persistedMessages,
    appendCompaction: (_chatId: string, summary: string, keptMessages: unknown[], _before: number, _after: number, summarizedMessages: number) => {
      appended.push({ summary, summarizedMessages, keptMessages: keptMessages.length });
    },
    getSessionSandboxOverride: () => null
  };

  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom",
    defaultCustomProviderId: "compaction-test",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|compaction-test|compact-model"
    },
    customProviders: [
      {
        id: "compaction-test",
        name: "Compaction Test",
        enabled: true,
        protocol: "openai-compatible",
        baseUrl: "https://example.invalid/v1",
        apiKey: "test-key",
        path: "/chat/completions",
        defaultModel: "compact-model",
        models: [
          {
            id: "compact-model",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ]
  };

  const testSessionId = `session-compact-${Date.now()}-${Math.random()}`;
  const runner = new MomRunner(
    "telegram",
    "chat-1",
    testSessionId,
    store as any,
    () => settings,
    () => settings,
    { record: () => {} } as any,
    { record: () => {} } as any,
    {} as any
  );

  (runner as any).agent.state.messages = [latestAssistantMessage];

  const result = await runner.compact({ reason: "manual" });

  assert.equal(result.changed, true);
  assert.equal(result.summarizedMessages, 1);
  assert.equal(result.keptMessages, 1);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.summarizedMessages, 1);
  assert.equal(appended[0]?.keptMessages, 1);
  assert.match(appended[0]?.summary ?? "", /Earlier conversation was compacted|## Summary/);
});

test("host bash approval is forwarded to runner event sink but does not abort execution", async () => {
  const replaced: string[] = [];
  let savedContextCalls = 0;
  const appendedMessages: any[] = [];
  const events: any[] = [];

  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom",
    defaultCustomProviderId: "runner-test",
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|runner-test|fake-model"
    },
    customProviders: [
      {
        id: "runner-test",
        name: "Runner Test",
        enabled: true,
        protocol: "openai-compatible",
        baseUrl: "https://example.invalid/v1",
        apiKey: "test-key",
        path: "/chat/completions",
        defaultModel: "fake-model",
        models: [
          {
            id: "fake-model",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ]
  };

  const store = {
    getWorkspaceDir: () => process.cwd(),
    getScratchDir: () => process.cwd(),
    getSessionEntriesPath: () => "entries.jsonl",
    saveContext: () => {
      savedContextCalls += 1;
    },
    appendContextMessage: (_chatId: string, message: any) => {
      appendedMessages.push(message);
    },
    appendRunSummary: () => {},
    appendRunDetail: () => {},
    appendRuntimeEvent: () => {},
    loadContext: () => appendedMessages,
    getSessionSandboxOverride: () => null
  };

  const testSessionId = `session-bash-approval-${Date.now()}-${Math.random()}`;
  const runner = new MomRunner(
    "telegram",
    "chat-1",
    testSessionId,
    store as any,
    () => settings,
    () => settings,
    { record: () => {} } as any,
    { record: () => {} } as any,
    {
      syncExternalMemories: async () => {},
      createPromptSnapshot: async () => ({
        createdAt: new Date().toISOString(),
        fingerprint: "test",
        query: "hello",
        promptText: "(memory)",
        selected: [],
        longTerm: [],
        daily: []
      })
    } as any
  );

  let subscriber: ((event: any) => void) | undefined;
  let aborted = false;
  (runner as any).agent = {
    state: {
      messages: [],
      tools: [],
      systemPrompt: "test",
      model: resolveModelSelection(settings, "text").model,
      thinkingLevel: settings.defaultThinkingLevel
    },
    sessionId: "test",
    transport: "responses",
    subscribe: (fn: (event: any) => void) => {
      subscriber = fn;
      return () => {};
    },
    abort: () => {
      aborted = true;
    },
    followUp: () => {},
    prompt: async () => {
      subscriber?.({
        type: "tool_execution_start",
        toolName: "bash",
        args: { label: "bash" }
      });
      subscriber?.({
        type: "tool_execution_end",
        toolName: "bash",
        isError: true,
        result: {
          content: [{ type: "text", text: "Host tool approval requested." }],
          details: {
            hostBashApproval: {
              type: "host_bash_approval",
              requestId: "hba-1",
              title: "Host Bash approval",
              body: "approve me",
              options: [],
              request: {
                toolId: "longbridge",
                displayName: "longbridge",
                command: "longbridge",
                args: ["--version"],
                approvalMode: "persistent",
                reason: "test",
                permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
                requestedAt: new Date().toISOString()
              }
            }
          }
        }
      });
      const assistantMessage = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Done" }],
        timestamp: Date.now()
      };
      (runner as any).agent.state.messages.push(assistantMessage);
      subscriber?.({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "Done" }]
        }
      });
    }
  };

  const result = await runner.run({
    channel: "telegram",
    workspaceDir: process.cwd(),
    chatDir: process.cwd(),
    message: {
      chatId: "chat-1",
      chatType: "private",
      messageId: 1,
      userId: "user-1",
      text: "run blocked tool",
      ts: new Date().toISOString(),
      attachments: [],
      imageContents: []
    },
    respond: async () => {},
    replaceMessage: async (text: string) => {
      replaced.push(text);
    },
    respondInThread: async () => {},
    setTyping: async () => {},
    setWorking: async () => {},
    deleteMessage: async () => {},
    uploadFile: async () => {},
    onRunnerEvent: async (event: any) => {
      events.push(event);
    }
  } as any);

  assert.equal(aborted, false);
  assert.equal(result.stopReason, "stop");
  assert.equal(appendedMessages.length, 2);
  assert.equal(appendedMessages[0]?.role, "user");
  assert.equal(appendedMessages[1]?.role, "assistant");
  const approvalEvent = events.find((e) => e.hostBashApproval);
  assert.ok(approvalEvent);
  assert.equal(approvalEvent.hostBashApproval.requestId, "hba-1");
});

test("runner persists user and partial assistant error when a run throws after streaming", async () => {
  const settings = createRunnerTestSettings();
  const appendedMessages: any[] = [];
  const store = {
    getWorkspaceDir: () => process.cwd(),
    getScratchDir: () => process.cwd(),
    getSessionEntriesPath: () => "entries.jsonl",
    saveContext: () => {
      throw new Error("saveContext should not rewrite successful or failed runs");
    },
    appendContextMessage: (_chatId: string, message: any) => {
      appendedMessages.push(message);
    },
    appendRunSummary: () => {},
    appendRunDetail: () => {},
    appendRuntimeEvent: () => {},
    loadContext: () => appendedMessages,
    getSessionSandboxOverride: () => null
  };

  const testSessionId = `session-throw-after-stream-${Date.now()}-${Math.random()}`;
  const runner = new MomRunner(
    "telegram",
    "chat-1",
    testSessionId,
    store as any,
    () => settings,
    () => settings,
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any
  );

  let subscriber: ((event: any) => void) | undefined;
  (runner as any).agent = {
    state: {
      messages: [],
      tools: [],
      systemPrompt: "test",
      model: resolveModelSelection(settings, "text").model,
      thinkingLevel: settings.defaultThinkingLevel
    },
    sessionId: "test",
    transport: "responses",
    subscribe: (fn: (event: any) => void) => {
      subscriber = fn;
      return () => {};
    },
    abort: () => {},
    followUp: () => {},
    prompt: async () => {
      subscriber?.({
        type: "message_start",
        message: { role: "assistant", content: [], stopReason: "stop" }
      });
      subscriber?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "partial answer" },
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial answer" }],
          stopReason: "stop"
        }
      });
      throw new Error("stream exploded");
    }
  };

  const result = await runner.run(createRunnerContext("hello"));

  assert.equal(result.stopReason, "error");
  assert.equal(appendedMessages.length, 2);
  assert.equal(appendedMessages[0]?.role, "user");
  assert.match(JSON.stringify(appendedMessages[0]?.content), /hello/);
  assert.equal(appendedMessages[1]?.role, "assistant");
  assert.equal(appendedMessages[1]?.stopReason, "error");
  assert.match(appendedMessages[1]?.errorMessage ?? "", /stream exploded/);
  assert.match(JSON.stringify(appendedMessages[1]?.content), /partial answer/);
});

test("runner persists user and assistant error when a run throws before output", async () => {
  const settings = createRunnerTestSettings();
  const appendedMessages: any[] = [];
  const store = {
    getWorkspaceDir: () => process.cwd(),
    getScratchDir: () => process.cwd(),
    getSessionEntriesPath: () => "entries.jsonl",
    saveContext: () => {
      throw new Error("saveContext should not rewrite failed runs");
    },
    appendContextMessage: (_chatId: string, message: any) => {
      appendedMessages.push(message);
    },
    appendRunSummary: () => {},
    appendRunDetail: () => {},
    appendRuntimeEvent: () => {},
    loadContext: () => appendedMessages,
    getSessionSandboxOverride: () => null
  };

  const testSessionId = `session-throw-before-output-${Date.now()}-${Math.random()}`;
  const runner = new MomRunner(
    "telegram",
    "chat-1",
    testSessionId,
    store as any,
    () => settings,
    () => settings,
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any
  );

  (runner as any).agent = {
    state: {
      messages: [],
      tools: [],
      systemPrompt: "test",
      model: resolveModelSelection(settings, "text").model,
      thinkingLevel: settings.defaultThinkingLevel
    },
    sessionId: "test",
    transport: "responses",
    subscribe: () => () => {},
    abort: () => {},
    followUp: () => {},
    prompt: async () => {
      throw new Error("request failed");
    }
  };

  const result = await runner.run(createRunnerContext("hello"));

  assert.equal(result.stopReason, "error");
  assert.equal(appendedMessages.length, 2);
  assert.equal(appendedMessages[0]?.role, "user");
  assert.equal(appendedMessages[1]?.role, "assistant");
  assert.equal(appendedMessages[1]?.stopReason, "error");
  assert.match(appendedMessages[1]?.errorMessage ?? "", /request failed/);
  assert.doesNotMatch(JSON.stringify(appendedMessages[0]?.content), /request failed/);
  assert.deepEqual(
    ((runner as any).agent.state.messages as any[]).map((message) => message.role),
    ["user"]
  );
});

test("runner hook bridge emits tool blocked when gate denies tool execution", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = {
    register: () => {},
    unregister: () => false,
    list: () => [],
    registerPlugin: async () => {},
    unregisterPlugin: async () => false,
    emit: (stage: string, _context: unknown, payload: any) => {
      events.push({ stage, payload });
    },
    flush: async () => {},
    transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
    gate: async () => ({ type: "deny", reason: "blocked by test hook" })
  } as any;

  const runner = new MomRunner(
    "telegram",
    "chat-hook-gate",
    `session-hook-gate-${Date.now()}`,
    new (await import("$lib/server/agent/session/store.js")).MomRuntimeStore(process.cwd()),
    createRunnerTestSettings,
    (patch: Partial<RuntimeSettings>) => ({ ...createRunnerTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any,
    hookManager
  );

  (runner as any).activeHookContext = {
    runId: "run-tool-blocked-hook",
    channel: "telegram",
    chatId: "chat-hook-gate",
    sessionId: "session-hook-gate"
  };

  const agent = (runner as any).agent;
  const result = await agent.beforeToolCall({
    toolCall: { id: "tool-1", name: "bash", input: {} },
    args: { command: "date" },
    assistantMessage: { role: "assistant", content: [], timestamp: Date.now() },
    context: { systemPrompt: "", messages: [], tools: [] }
  });

  assert.deepEqual(result, { block: true, reason: "blocked by test hook" });
  assert.equal(events.some((event) => event.stage === "tool.call.blocked"), true);
  assert.equal(events.find((event) => event.stage === "tool.call.blocked")?.payload.blockedBy, "hook_gate");
});

test("runner hook bridge emits model call pairing fields", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = {
    register: () => {},
    unregister: () => false,
    list: () => [],
    registerPlugin: async () => {},
    unregisterPlugin: async () => false,
    emit: (stage: string, _context: unknown, payload: any) => {
      events.push({ stage, payload });
    },
    flush: async () => {},
    transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
    gate: async () => ({ type: "allow" })
  } as any;

  const runner = new MomRunner(
    "telegram",
    "chat-model-hook",
    `session-model-hook-${Date.now()}`,
    new (await import("$lib/server/agent/session/store.js")).MomRuntimeStore(process.cwd()),
    createRunnerTestSettings,
    (patch: Partial<RuntimeSettings>) => ({ ...createRunnerTestSettings(), ...patch }),
    { record: () => {} } as any,
    { record: () => {} } as any,
    createRunnerTestMemory() as any,
    hookManager
  );

  (runner as any).activeHookContext = {
    runId: "run-model-hook",
    channel: "telegram",
    chatId: "chat-model-hook",
    sessionId: "session-model-hook"
  };
  (runner as any).activePayloadContext = {
    provider: "provider-1",
    model: "model-1",
    api: "openai-compatible",
    requestedThinkingLevel: "off",
    effectiveThinkingLevel: "off"
  };
  (runner as any).activeModelPromptContext = {
    candidateIndex: 0,
    attemptIndex: 0
  };

  const agent = (runner as any).agent;
  await agent.onPayload?.({});
  await agent.onResponse?.({ usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 }, stopReason: "stop" } as any);
  await agent.onPayload?.({});
  await agent.onResponse?.({ usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, totalTokens: 26 }, stopReason: "tool_use" } as any);

  const before = events.filter((event) => event.stage === "model.call.before");
  const after = events.filter((event) => event.stage === "model.call.after");
  assert.equal(before.length, 2);
  assert.equal(after.length, 2);
  assert.equal(before[0]?.payload.modelAttemptId, "run-model-hook:0:0:1");
  assert.equal(before[1]?.payload.modelAttemptId, "run-model-hook:0:0:2");
  assert.equal(after[0]?.payload.modelCallSeq, 1);
  assert.equal(after[1]?.payload.modelCallSeq, 2);
  assert.notEqual(after[0]?.payload.modelAttemptId, after[1]?.payload.modelAttemptId);
  assert.deepEqual(after[0]?.payload.usage, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 });
  assert.deepEqual(after[1]?.payload.usage, { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, totalTokens: 26 });
});

test("runner emits skill.selected without treating workspace scan as skill.loaded", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = createRunnerHookManager(events);
  const runner = await createRunnerForHookTest({ chatId: "chat-skill-hook", hookManager });

  (runner as any).activeHookContext = {
    runId: "run-skill-hook",
    channel: "telegram",
    chatId: "chat-skill-hook",
    sessionId: "session-skill-hook"
  };

  (runner as any).emitSkillSelectionForTest([
    { name: "example-skill", scope: "bot", filePath: "/tmp/SKILL.md", aliases: [] }
  ]);

  assert.equal(events.some((event) => event.stage === "skill.selected"), true);
  assert.equal(events.some((event) => event.stage === "skill.loaded"), false);
});

test("runner emits skill.loaded when read opens an active skill file", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = createRunnerHookManager(events);
  const runner = await createRunnerForHookTest({ chatId: "chat-read-skill", hookManager });
  activateHookContext(runner, "run-read-skill", "chat-read-skill");
  const skillPath = join(process.cwd(), "skills", "example", "SKILL.md");
  setActiveSkill(runner, skillPath);

  const agent = (runner as any).agent;
  const beforeResult = await agent.beforeToolCall(readToolCall("read-skill-1", skillPath));
  assert.equal(beforeResult, undefined);
  assert.equal((runner as any).getPendingReadPathCountForTest(), 1);

  await agent.afterToolCall({
    toolCall: { id: "read-skill-1", name: "read", input: {} },
    result: { content: [{ type: "text", text: "skill body" }] },
    isError: false
  });

  assert.equal((runner as any).getPendingReadPathCountForTest(), 0);
  const loaded = events.find((event) => event.stage === "skill.loaded");
  assert.equal(loaded?.payload.name, "example-skill");
  assert.equal(loaded?.payload.reason, "read_skill_file");
});

test("runner clears pending read paths on read error without emitting skill.loaded", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = createRunnerHookManager(events);
  const runner = await createRunnerForHookTest({ chatId: "chat-read-error", hookManager });
  activateHookContext(runner, "run-read-error", "chat-read-error");
  const skillPath = join(process.cwd(), "skills", "example-error", "SKILL.md");
  setActiveSkill(runner, skillPath);

  const agent = (runner as any).agent;
  await agent.beforeToolCall(readToolCall("read-skill-error", skillPath));
  assert.equal((runner as any).getPendingReadPathCountForTest(), 1);

  await agent.afterToolCall({
    toolCall: { id: "read-skill-error", name: "read", input: {} },
    result: { content: [{ type: "text", text: "missing" }] },
    isError: true
  });

  assert.equal((runner as any).getPendingReadPathCountForTest(), 0);
  assert.equal(events.some((event) => event.stage === "skill.loaded"), false);
});

test("runner does not emit skill.loaded for non-skill read paths", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = createRunnerHookManager(events);
  const runner = await createRunnerForHookTest({ chatId: "chat-read-non-skill", hookManager });
  activateHookContext(runner, "run-read-non-skill", "chat-read-non-skill");
  const skillPath = join(process.cwd(), "skills", "expected", "SKILL.md");
  setActiveSkill(runner, skillPath);

  const agent = (runner as any).agent;
  await agent.beforeToolCall(readToolCall("read-not-skill", join(process.cwd(), "notes", "SKILL.md")));
  await agent.afterToolCall({
    toolCall: { id: "read-not-skill", name: "read", input: {} },
    result: { content: [{ type: "text", text: "not a tracked skill" }] },
    isError: false
  });

  assert.equal((runner as any).getPendingReadPathCountForTest(), 0);
  assert.equal(events.some((event) => event.stage === "skill.loaded"), false);
});

test("runner does not cache blocked read calls", async () => {
  const events: Array<{ stage: string; payload: any }> = [];
  const hookManager = createRunnerHookManager(events, () => ({ type: "deny", reason: "blocked by test hook" }));
  const runner = await createRunnerForHookTest({ chatId: "chat-read-blocked", hookManager });
  activateHookContext(runner, "run-read-blocked", "chat-read-blocked");
  const skillPath = join(process.cwd(), "skills", "blocked", "SKILL.md");
  setActiveSkill(runner, skillPath);

  const agent = (runner as any).agent;
  const result = await agent.beforeToolCall(readToolCall("read-skill-blocked", skillPath));

  assert.deepEqual(result, { block: true, reason: "blocked by test hook" });
  assert.equal((runner as any).getPendingReadPathCountForTest(), 0);
  assert.equal(events.some((event) => event.stage === "tool.call.blocked"), true);
  assert.equal(events.some((event) => event.stage === "skill.loaded"), false);
});

test("runner matches read skill paths after tool path correction", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "molipibot-skill-track-"));
  try {
    const workspaceDir = join(tempRoot, "moli-t", "bots", "bot-a");
    const chatId = "chat-corrected";
    const skillPath = join(tempRoot, "skills", "corrected", "SKILL.md");
    const events: Array<{ stage: string; payload: any }> = [];
    const hookManager = createRunnerHookManager(events);
    const runner = await createRunnerForHookTest({ chatId, workspaceDir, hookManager });
    activateHookContext(runner, "run-corrected", chatId);
    setActiveSkill(runner, skillPath);

    const agent = (runner as any).agent;
    await agent.beforeToolCall(readToolCall("read-corrected", "data/moli-t/skills/corrected/SKILL.md"));
    await agent.afterToolCall({
      toolCall: { id: "read-corrected", name: "read", input: {} },
      result: { content: [{ type: "text", text: "skill body" }] },
      isError: false
    });

    const loaded = events.find((event) => event.stage === "skill.loaded");
    assert.equal(loaded?.payload.filePath, skillPath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
