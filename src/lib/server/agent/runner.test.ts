import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantStreamEvent } from "./assistantStream.js";
import { defaultRuntimeSettings } from "../settings/defaults.js";
import type { RuntimeSettings } from "../settings/schema.js";
import { MomRunner, decideVisionRouting, resolveModelSelection } from "./runner.js";

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
    }
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

  const runner = new MomRunner(
    "telegram",
    "chat-1",
    "session-1",
    store as any,
    () => settings,
    () => settings,
    {} as any,
    {} as any,
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

test("host approval tool failures abort the current run and wait for approval", async () => {
  const replaced: string[] = [];
  let savedContextCalls = 0;

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
    appendRunSummary: () => {},
    appendRuntimeEvent: () => {},
    loadContext: () => []
  };

  const runner = new MomRunner(
    "telegram",
    "chat-1",
    "session-1",
    store as any,
    () => settings,
    () => settings,
    { record: () => {} } as any,
    {} as any,
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
            hostToolApproval: {
              type: "host_tool_approval",
              requestId: "hta-1",
              title: "Host tool approval",
              body: "approve me",
              options: [],
              request: {
                toolId: "cat",
                displayName: "cat",
                command: "cat",
                args: [".env"],
                reason: "test",
                permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
                requestedAt: new Date().toISOString()
              }
            }
          }
        }
      });
      subscriber?.({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "aborted",
          content: []
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
    uploadFile: async () => {}
  } as any);

  assert.equal(aborted, true);
  assert.equal(result.stopReason, "aborted");
  assert.equal(savedContextCalls, 0);
  assert.equal(replaced.at(-1), "Host tool approval requested. Waiting for your decision.");
});
