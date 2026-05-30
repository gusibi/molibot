import assert from "node:assert/strict";
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
