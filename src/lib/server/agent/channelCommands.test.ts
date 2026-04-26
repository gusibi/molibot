import test from "node:test";
import assert from "node:assert/strict";
import { SharedRuntimeCommandService } from "./channelCommands.js";
import { defaultRuntimeSettings } from "../settings/defaults.js";
import type { RuntimeSettings } from "../settings/index.js";

test("status command includes current session token stats", async () => {
  const sent: string[] = [];
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 12,
      estimatedContextTokens: 3456,
      compactionCount: 1,
      latestCompaction: {
        timestamp: "2026-04-18T00:00:00.000Z",
        tokensBefore: 8000,
        tokensAfter: 3200,
        summarizedMessages: 18,
        reason: "manual" as const
      },
      usage: {
        runCount: 3,
        inputTokens: 123,
        outputTokens: 45,
        cacheReadTokens: 6,
        cacheWriteTokens: 7,
        totalTokens: 181
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/status",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /Current context≈: 3,456 tokens/);
  assert.match(sent[0] ?? "", /Session token total: 181/);
  assert.match(sent[0] ?? "", /Session input\/output: 123 \/ 45/);
  assert.match(sent[0] ?? "", /Compactions: 1/);
});

test("status command renders markdown table on qq", async () => {
  const sent: string[] = [];
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 12,
      estimatedContextTokens: 3456,
      compactionCount: 1,
      latestCompaction: null,
      usage: {
        runCount: 3,
        inputTokens: 123,
        outputTokens: 45,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 181
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "qq",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "qq",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/status",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /\*\*Status\*\*/);
  assert.match(sent[0] ?? "", /\| Item \| Value \|/);
  assert.match(sent[0] ?? "", /\| Current context≈ \| 3,456 tokens \|/);
});

test("help command renders markdown table on weixin but stays plain text on telegram", async () => {
  const createStore = () =>
    ({
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    }) as any;

  const weixinSent: string[] = [];
  const telegramSent: string[] = [];

  const weixinService = new SharedRuntimeCommandService<string>({
    channel: "weixin",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "weixin",
    store: createStore(),
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      weixinSent.push(text);
    }
  });

  const telegramService = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: createStore(),
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      telegramSent.push(text);
    }
  });

  await weixinService.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/help",
    target: "target-1"
  });
  await telegramService.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/help",
    target: "target-1"
  });

  assert.match(weixinSent[0] ?? "", /\*\*Available commands\*\*/);
  assert.match(weixinSent[0] ?? "", /\| \/status \| show current bot\/session\/runtime status \|/);
  assert.doesNotMatch(telegramSent[0] ?? "", /\| Item \| Value \|/);
  assert.match(telegramSent[0] ?? "", /Available commands:/);
  assert.match(telegramSent[0] ?? "", /\/status - show current bot\/session\/runtime status/);
});

test("models command renders numbered markdown table with provider and model columns", async () => {
  const sent: string[] = [];
  const settings: RuntimeSettings = {
    ...defaultRuntimeSettings,
    providerMode: "custom" as const,
    defaultCustomProviderId: "grok2api",
    customProviders: [
      {
        id: "grok2api",
        name: "Grok2Api",
        enabled: true,
        baseUrl: "http://localhost:8001/v1",
        apiKey: "test-key",
        defaultModel: "grok-4.20-fast",
        path: "/chat/completions",
        models: [
          {
            id: "grok-4.20-auto",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          },
          {
            id: "grok-4.20-fast",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool", "developer"]
          }
        ]
      }
    ],
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      textModelKey: "custom|grok2api|grok-4.20-fast"
    }
  };
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 0,
      estimatedContextTokens: 0,
      compactionCount: 0,
      latestCompaction: null,
      usage: {
        runCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => settings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/models",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /当前模型列表（共3个）：/);
  assert.match(sent[0] ?? "", /\| 编号 \| 供应商 \| 模型 \|/);
  assert.match(sent[0] ?? "", /\| 1 \| \[Built-in\] anthropic \| claude-sonnet-4-20250514 \|/);
  assert.match(sent[0] ?? "", /\| 2 \| Grok2Api \| grok-4\.20-auto \|/);
  assert.match(sent[0] ?? "", /\| 3 ⭐ 当前活跃中 \| Grok2Api \| grok-4\.20-fast \|/);
  assert.match(sent[0] ?? "", /快捷切换：/);
});

test("stop command aborts current run and clears queued pending tasks", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => true,
    stopRun: () => ({ aborted: true }),
    cancelQueuedPending: async () => 2,
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/stop",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, ["Stopping... Cleared 2 queued task(s)."]);
});

test("stop command clears queued tasks even when nothing is currently running", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    cancelQueuedPending: async () => 3,
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/stop",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, ["No active task. Cleared 3 queued task(s)."]);
});

test("steer and followup commands use live runner controls", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => true,
    stopRun: () => ({ aborted: false }),
    steerRun: (_scopeId, text) => ({ queued: text === "correct that" }),
    followUpRun: (_scopeId, text) => ({ queued: text === "then summarize" }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/steer correct that",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/followup then summarize",
    target: "target-1"
  });

  assert.deepEqual(sent, [
    "Queued steering correction into current task.",
    "Queued follow-up after current task."
  ]);
});

test("steer and followup commands validate usage and running state", async () => {
  const sent: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    steerRun: () => ({ queued: false }),
    followUpRun: () => ({ queued: false }),
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/steer",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/followup later",
    target: "target-1"
  });

  assert.deepEqual(sent, [
    "Usage: /steer <text>",
    "Nothing running. Send a normal message instead."
  ]);
});

test("steer command can promote a queued item by queue id", async () => {
  const sent: string[] = [];
  const deletedIds: number[] = [];
  const steeredTexts: string[] = [];
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => true,
    stopRun: () => ({ aborted: false }),
    steerRun: (_scopeId, text) => {
      steeredTexts.push(text);
      return { queued: true };
    },
    getQueuedPreview: async (_scopeId, id) => ({
      status: id === 12 ? "pending" as const : "not_found" as const,
      preview: id === 12 ? "please correct the scope" : undefined
    }),
    deleteQueued: async (_scopeId, id) => {
      deletedIds.push(id);
      return "deleted";
    },
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/steer 12",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.deepEqual(steeredTexts, ["please correct the scope"]);
  assert.deepEqual(deletedIds, [12]);
  assert.deepEqual(sent, ["Injected queued task 12 into current task."]);
});

test("followup command keeps queued item when no active run is available", async () => {
  const sent: string[] = [];
  let deleted = false;
  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: {
      getActiveSession: () => "session-1",
      getSessionStatusSnapshot: () => ({
        messageCount: 0,
        estimatedContextTokens: 0,
        compactionCount: 0,
        latestCompaction: null,
        usage: {
          runCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0
        }
      }),
      listSessions: () => ["session-1"],
      getSessionThinkingLevelOverride: () => null
    } as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    followUpRun: () => ({ queued: false }),
    getQueuedPreview: async () => ({
      status: "pending" as const,
      preview: "then continue"
    }),
    deleteQueued: async () => {
      deleted = true;
      return "deleted";
    },
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  const handled = await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/followup 15",
    target: "target-1"
  });

  assert.equal(handled, true);
  assert.equal(deleted, false);
  assert.deepEqual(sent, ["Nothing running. Queue item 15 stays queued."]);
});

test("queue commands list, front insert, and delete pending tasks", async () => {
  const sent: string[] = [];
  const store = {
    getActiveSession: () => "session-1",
    getSessionStatusSnapshot: () => ({
      messageCount: 0,
      estimatedContextTokens: 0,
      compactionCount: 0,
      latestCompaction: null,
      usage: {
        runCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0
      }
    }),
    listSessions: () => ["session-1"],
    getSessionThinkingLevelOverride: () => null
  };

  const service = new SharedRuntimeCommandService<string>({
    channel: "telegram",
    instanceId: "bot-test",
    workspaceDir: process.cwd(),
    authScopePrefix: "telegram",
    store: store as any,
    runners: {} as any,
    getSettings: () => defaultRuntimeSettings,
    isRunning: () => false,
    stopRun: () => ({ aborted: false }),
    listQueue: async () => [
      { id: 11, status: "running", preview: "current task", createdAt: "2026-04-22T00:00:00.000Z" },
      { id: 12, status: "pending", preview: "queued task", createdAt: "2026-04-22T00:01:00.000Z" }
    ],
    deleteQueued: async (_scopeId, id) => (id === 12 ? "deleted" : "not_found"),
    enqueueFront: async () => 99,
    sendText: async (_target, text) => {
      sent.push(text);
    }
  });

  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/queue",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/queue front urgent task",
    target: "target-1"
  });
  await service.handle({
    chatId: "chat-1",
    scopeId: "chat-1",
    text: "/queue delete 12",
    target: "target-1"
  });

  assert.match(sent[0] ?? "", /#11 \[running\] current task/);
  assert.match(sent[0] ?? "", /#12 \[pending\] queued task/);
  assert.match(sent[1] ?? "", /Inserted at front of queue\. Queue ID: 99/);
  assert.match(sent[2] ?? "", /Deleted queued task 12\./);
});
