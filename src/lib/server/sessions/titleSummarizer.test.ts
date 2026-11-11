import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@earendil-works/pi-ai";
import { summarizeSessionTitleWithLlm, tryAutoSummarizeConversationTitleAsync } from "./titleSummarizer.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

const mockZhSettings: RuntimeSettings = {
  ...defaultRuntimeSettings,
  locale: "zh-CN",
  providerMode: "pi",
  piModelProvider: "openai",
  piModelName: "gpt-4o",
  customProviders: [],
  modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: "pi|openai|gpt-4o" },
  modelFallback: { mode: "same-provider", firstTokenTimeoutMs: 15000 },
  defaultThinkingLevel: "off",
  compaction: { enabled: true, thresholdPercent: 80, reserveTokens: 4096, keepRecentTokens: 2048, defaultContextWindow: 128000 },
  timezone: "UTC"
};

const mockEnSettings: RuntimeSettings = {
  ...defaultRuntimeSettings,
  locale: "en-US",
  providerMode: "pi",
  piModelProvider: "openai",
  piModelName: "gpt-4o",
  customProviders: [],
  modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: "pi|openai|gpt-4o" },
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
  return (_model: unknown, context: Context, options?: any) => {
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
  assert.equal(captured.options?.maxTokens, 2048);
  assert.equal(captured.options?.reasoning, "low");
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

test("summarizeSessionTitleWithLlm forwards sessionId into stream options", async () => {
  const captured: { context?: Context; options?: Record<string, unknown> } = {};

  await summarizeSessionTitleWithLlm(
    "请帮我写一个 Python 脚本用于清理 CSV 数据文件中的重复项和空值",
    mockZhSettings,
    {
      sessionId: "s-20260912-eqpo",
      streamFn: createMockStreamFn("标题", "stop", captured),
      resolveApiKeyFn: async () => "dummy-key"
    }
  );

  assert.equal(captured.options?.sessionId, "s-20260912-eqpo");
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
      listMessages: () => [{ role: "user", content: "请帮我写一个 Python 脚本用于清理 CSV 数据文件中的重复项和空值" }],
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

// Regression: a failed first attempt (LLM timeout, missing key) used to leave
// the session titled "New Session" forever, because only the turn with exactly
// one user message could summarize. The retry gate is now the title state
// itself: default title → summarize on any turn; real title → never touch it.
test("tryAutoSummarizeConversationTitleAsync retries on later turns while the title is still default", async () => {
  let streamCalls = 0;
  const renames: Array<{ conversationId: string; title: string }> = [];
  (globalThis as any).__molibotRuntime = {
    sessions: {
      getConversationById: () => ({
        id: "conv-1",
        title: "New Session",
        channel: "web",
        externalUserId: "user-1"
      }),
      listMessages: () => [
        { role: "user", content: "first turn" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second turn" }
      ],
      renameConversation: (conversationId: string, _channel: string, _externalUserId: string, title: string) => {
        renames.push({ conversationId, title });
        return true;
      }
    },
    getSettings: () => mockZhSettings
  };

  try {
    const title = await tryAutoSummarizeConversationTitleAsync({
      conversationId: "conv-1",
      externalUserId: "user-1",
      firstUserMessage: "second turn",
      options: {
        streamFn: (model, context, options) => {
          streamCalls += 1;
          return createMockStreamFn("第二轮主题")(model, context, options);
        },
        resolveApiKeyFn: async () => "dummy-key"
      }
    });

    assert.equal(title, "第二轮主题");
    assert.equal(streamCalls, 1);
    assert.equal(renames.length, 1);
    assert.equal(renames[0].title, "第二轮主题");
  } finally {
    delete (globalThis as any).__molibotRuntime;
  }
});

test("tryAutoSummarizeConversationTitleAsync never overwrites a customized title", async () => {
  let streamCalls = 0;
  let renameCalls = 0;
  (globalThis as any).__molibotRuntime = {
    sessions: {
      getConversationById: () => ({
        id: "conv-1",
        title: "用户自己改过的标题",
        channel: "web",
        externalUserId: "user-1"
      }),
      listMessages: () => [
        { role: "user", content: "first turn" },
        { role: "user", content: "second turn" }
      ],
      renameConversation: () => {
        renameCalls += 1;
        return true;
      }
    },
    getSettings: () => mockZhSettings
  };

  try {
    const title = await tryAutoSummarizeConversationTitleAsync({
      conversationId: "conv-1",
      externalUserId: "user-1",
      firstUserMessage: "second turn",
      options: {
        streamFn: (model, context, options) => {
          streamCalls += 1;
          return createMockStreamFn("不应生成标题")(model, context, options);
        },
        resolveApiKeyFn: async () => "dummy-key"
      }
    });

    assert.equal(title, null);
    assert.equal(streamCalls, 0);
    assert.equal(renameCalls, 0);
  } finally {
    delete (globalThis as any).__molibotRuntime;
  }
});

for (const stopReason of ["aborted", "length"]) {
  test(`a ${stopReason} title attempt retries a persisted snippet on a later turn`, async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { storagePaths } = await import("$lib/server/infra/db/storage.js");
    const { SessionStore } = await import("./store.js");
    const originalPaths = { ...storagePaths };
    const root = mkdtempSync(join(tmpdir(), "molibot-title-retry-"));
    const originalRuntime = (globalThis as any).__molibotRuntime;
    try {
      Object.assign(storagePaths, { dataDir: root, sessionsDir: join(root, "legacy"), webWorkspaceDir: join(root, "web") });
      let sessions = new SessionStore();
      const owner = "web:personal:web-anonymous";
      const conversation = sessions.createWebConversation(owner);
      const first = "现在我发现我的 WiFi 很慢，但是直接测速的话就很快，我不知道是什么原因，帮我排查一下";
      sessions.appendMessage(conversation.id, "user", first);
      (globalThis as any).__molibotRuntime = { sessions, getSettings: () => mockZhSettings };
      assert.equal(await tryAutoSummarizeConversationTitleAsync({
        conversationId: conversation.id, externalUserId: owner, firstUserMessage: first,
        options: { streamFn: createMockStreamFn("", stopReason), resolveApiKeyFn: async () => "dummy-key" }
      }), null);
      sessions = new SessionStore();
      (globalThis as any).__molibotRuntime.sessions = sessions;
      assert.equal(sessions.getConversationById(conversation.id, "web", owner)?.title, first.slice(0, 40) + "...");
      sessions.appendMessage(conversation.id, "user", "继续帮我排查");
      const captured: { context?: Context } = {};
      const title = await tryAutoSummarizeConversationTitleAsync({
        conversationId: conversation.id, externalUserId: owner, firstUserMessage: "继续帮我排查",
        options: { streamFn: createMockStreamFn("WiFi速度异常排查", "stop", captured), resolveApiKeyFn: async () => "dummy-key" }
      });
      assert.equal(title, "WiFi速度异常排查");
      assert.match(String(captured.context?.messages[0]?.content), /WiFi 很慢/);
      assert.equal(new SessionStore().getConversationById(conversation.id, "web", owner)?.title, title);
    } finally {
      Object.assign(storagePaths, originalPaths);
      (globalThis as any).__molibotRuntime = originalRuntime;
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a manual rename during title generation is preserved without notifying the UI", async () => {
  const originalRuntime = (globalThis as any).__molibotRuntime;
  let currentTitle = "New Session";
  let renamed = false;
  let notified = false;
  (globalThis as any).__molibotRuntime = {
    sessions: {
      getConversationById: () => ({ title: currentTitle }),
      listMessages: () => [{ role: "user", content: "请帮我清理数据" }],
      renameConversation: () => { renamed = true; }
    },
    getSettings: () => mockZhSettings
  };
  try {
    const result = await tryAutoSummarizeConversationTitleAsync({
      conversationId: "conv-rename", externalUserId: "user-1", firstUserMessage: "请帮我清理数据",
      onTitleUpdated: () => { notified = true; },
      options: {
        resolveApiKeyFn: async () => "dummy-key",
        streamFn: (...args) => {
          currentTitle = "我的手动标题";
          return createMockStreamFn("数据清理")(...args);
        }
      }
    });
    assert.equal(result, null);
    assert.equal(renamed, false);
    assert.equal(notified, false);
  } finally {
    (globalThis as any).__molibotRuntime = originalRuntime;
  }
});

test("title requests tolerate more than eight seconds and abort at thirty seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started!: () => void;
  const streamStarted = new Promise<void>(resolve => { started = resolve; });
  let signal!: AbortSignal;
  const result = summarizeSessionTitleWithLlm("帮我排查网络速度", mockZhSettings, {
    resolveApiKeyFn: async () => "dummy-key",
    streamFn: (_model, _context, options) => {
      signal = options!.signal!;
      const settled = new Promise(resolve => {
        signal.addEventListener("abort", () => resolve({ stopReason: "aborted", content: [] }), { once: true });
      });
      started();
      return { result: () => settled } as ReturnType<ReturnType<typeof createMockStreamFn>>;
    }
  });
  await streamStarted;
  t.mock.timers.tick(8001);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(21_999);
  assert.equal(signal.aborted, true);
  assert.equal(await result, null);
});

test("overlapping sends share one title request", async () => {
  const originalRuntime = (globalThis as any).__molibotRuntime;
  let calls = 0;
  let title = "New Session";
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  (globalThis as any).__molibotRuntime = {
    sessions: {
      getConversationById: () => ({ title }),
      listMessages: () => [{ role: "user", content: "网络排查" }],
      renameConversation: (_id: string, _channel: string, _owner: string, value: string) => ({ title: title = value })
    },
    getSettings: () => mockZhSettings
  };
  try {
    const params = {
      conversationId: "conv-overlap", externalUserId: "user-1", firstUserMessage: "网络排查",
      options: {
        resolveApiKeyFn: async () => "dummy-key",
        streamFn: (...args: Parameters<ReturnType<typeof createMockStreamFn>>) => {
          calls++;
          started();
          return { result: async () => { await waiting; return createMockStreamFn("网络速度排查")(...args).result(); } } as ReturnType<ReturnType<typeof createMockStreamFn>>;
        }
      }
    };
    const first = tryAutoSummarizeConversationTitleAsync(params);
    await ready;
    assert.equal(await tryAutoSummarizeConversationTitleAsync(params), null);
    finish();
    assert.equal(await first, "网络速度排查");
    assert.equal(calls, 1);
  } finally {
    finish();
    (globalThis as any).__molibotRuntime = originalRuntime;
  }
});
