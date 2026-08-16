import { test } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@earendil-works/pi-ai";
import { summarizeSessionTitleWithLlm, tryAutoSummarizeConversationTitleAsync } from "./titleSummarizer.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const mockZhSettings: RuntimeSettings = {
  locale: "zh-CN",
  providerMode: "pi",
  piModelProvider: "openai",
  piModelName: "gpt-4o",
  customProviders: [],
  modelRouting: { textModelKey: "pi|openai|gpt-4o" },
  modelFallback: { mode: "same-provider", firstTokenTimeoutMs: 15000 },
  defaultThinkingLevel: "off",
  compaction: { enabled: true, thresholdPercent: 80, reserveTokens: 4096, keepRecentTokens: 2048, defaultContextWindow: 128000 },
  timezone: "UTC"
};

const mockEnSettings: RuntimeSettings = {
  locale: "en-US",
  providerMode: "pi",
  piModelProvider: "openai",
  piModelName: "gpt-4o",
  customProviders: [],
  modelRouting: { textModelKey: "pi|openai|gpt-4o" },
  modelFallback: { mode: "same-provider", firstTokenTimeoutMs: 15000 },
  defaultThinkingLevel: "off",
  compaction: { enabled: true, thresholdPercent: 80, reserveTokens: 4096, keepRecentTokens: 2048, defaultContextWindow: 128000 },
  timezone: "UTC"
};

/**
 * Creates a mock streamFn that mimics streamWithPiRuntime's return shape:
 * returns an object with a `.result()` method that resolves to an AssistantMessage.
 */
function createMockStreamFn(
  responseText: string,
  stopReason = "stop",
  captureRef?: { context?: Context; options?: Record<string, unknown> }
) {
  return (_model: unknown, context: Context, options?: Record<string, unknown>) => {
    if (captureRef) {
      captureRef.context = context;
      captureRef.options = options;
    }
    return {
      result: () => Promise.resolve({
        stopReason,
        content: [{ type: "text", text: responseText }]
      }),
      [Symbol.asyncIterator]: async function* () { /* noop */ }
    } as any;
  };
}

test("summarizeSessionTitleWithLlm includes Chinese system prompt when locale is zh-CN", async () => {
  const captured: { context?: Context; options?: Record<string, unknown> } = {};

  const title = await summarizeSessionTitleWithLlm(
    "请帮我写一个 Python 脚本用于清理 CSV 数据文件中的重复项和空值",
    mockZhSettings,
    {
      streamFn: createMockStreamFn("「Python数据清洗方案」", "stop", captured),
      resolveApiKeyFn: async () => "dummy-key"
    }
  );

  assert.equal(title, "Python数据清洗方案");
  assert.equal(captured.context?.systemPrompt, "你是一个会话标题总结助手。你的任务是用中文将用户提问提炼为简短精炼的一句话标题。");
  assert.match(captured.context?.messages[0]?.content as string ?? "", /必须使用中文输出/);
  assert.equal(captured.options?.reasoning, "off");
});

test("summarizeSessionTitleWithLlm includes English system prompt when locale is en-US", async () => {
  const captured: { context?: Context; options?: Record<string, unknown> } = {};

  const title = await summarizeSessionTitleWithLlm(
    "Please help me write a Python script to clean duplicate entries in CSV files",
    mockEnSettings,
    {
      streamFn: createMockStreamFn("Python CSV Cleaning", "stop", captured),
      resolveApiKeyFn: async () => "dummy-key"
    }
  );

  assert.equal(title, "Python CSV Cleaning");
  assert.equal(captured.context?.systemPrompt, "You are a session title summarizer. Your task is to extract a concise single-line title in English for the provided text.");
  assert.match(captured.context?.messages[0]?.content as string ?? "", /Output MUST be in English/);
});

test("summarizeSessionTitleWithLlm ignores slash commands", async () => {
  const title = await summarizeSessionTitleWithLlm("/status", mockZhSettings);
  assert.equal(title, null);
});

test("summarizeSessionTitleWithLlm handles LLM errors gracefully returning null", async () => {
  const title = await summarizeSessionTitleWithLlm(
    "处理某数据",
    mockZhSettings,
    {
      streamFn: createMockStreamFn("", "error"),
      resolveApiKeyFn: async () => "dummy-key"
    }
  );

  assert.equal(title, null);
});

test("summarizeSessionTitleWithLlm handles stream exceptions gracefully", async () => {
  const throwingStreamFn = () => {
    return {
      result: () => Promise.reject(new Error("Network error")),
      [Symbol.asyncIterator]: async function* () { /* noop */ }
    } as any;
  };

  const title = await summarizeSessionTitleWithLlm(
    "帮我做一个方案",
    mockZhSettings,
    {
      streamFn: throwingStreamFn,
      resolveApiKeyFn: async () => "dummy-key"
    }
  );

  assert.equal(title, null);
});

// Regression: the wrapper used to call `settings.get()` on the runtime, but the
// runtime exposes `getSettings()` - every background run threw
// "settings.get is not a function" and titles were never generated.
test("tryAutoSummarizeConversationTitleAsync reads settings through the runtime's getSettings and renames", async () => {
  const renames: Array<{ conversationId: string; channel: string; externalUserId: string; title: string }> = [];
  (globalThis as any).__molibotRuntime = {
    sessions: {
      getConversationById: (conversationId: string, channel: string, externalUserId: string) => ({
        id: conversationId,
        title: "New Session",
        channel,
        externalUserId
      }),
      renameConversation: (conversationId: string, channel: string, externalUserId: string, title: string) => {
        renames.push({ conversationId, channel, externalUserId, title });
        return true;
      }
    },
    // `settings.get()` would throw here; the wrapper must use getSettings().
    getSettings: () => mockZhSettings
  };

  try {
    const title = await tryAutoSummarizeConversationTitleAsync({
      conversationId: "conv-1",
      externalUserId: "user-1",
      firstUserMessage: "请帮我写一个 Python 脚本用于清理 CSV 数据文件中的重复项和空值",
      options: {
        streamFn: createMockStreamFn("Python数据清洗方案"),
        resolveApiKeyFn: async () => "dummy-key"
      }
    });

    assert.equal(title, "Python数据清洗方案");
    assert.equal(renames.length, 1);
    assert.equal(renames[0].title, "Python数据清洗方案");
    assert.equal(renames[0].conversationId, "conv-1");
    assert.equal(renames[0].channel, "web");
    assert.equal(renames[0].externalUserId, "user-1");
  } finally {
    delete (globalThis as any).__molibotRuntime;
  }
});
