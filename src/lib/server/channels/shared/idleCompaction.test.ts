import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { HookManager } from "$lib/server/agent/hooks";
import type { PromptChannel } from "$lib/server/agent/prompts/prompt-channel.js";
import { BaseChannelRuntime } from "$lib/server/channels/shared/baseRuntime.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { MemoryGateway } from "$lib/server/memory/gateway";
import { agentWorkspaceDir } from "$lib/server/sessions/agentStorage.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker";

class TestChannelRuntime extends BaseChannelRuntime {
  constructor(options: {
    channel: PromptChannel;
    instanceId: string;
    workspaceDir: string;
    getSettings: () => RuntimeSettings;
  }) {
    super({
      channel: options.channel,
      defaultWorkspaceName: options.channel,
      getSettings: options.getSettings,
      options: {
        workspaceDir: options.workspaceDir,
        instanceId: options.instanceId,
        memory: {} as MemoryGateway,
        usageTracker: {} as AiUsageTracker,
        modelErrorTracker: {} as ModelErrorTracker,
        hookManager: {} as HookManager
      }
    });
  }

  getRuntimeStore(): MomRuntimeStore {
    return this.store;
  }

  stubCompact(
    handler: (
      chatId: string,
      sessionId: string,
      options?: { reason?: "threshold" | "manual"; customInstructions?: string }
    ) => Promise<{
      changed: boolean;
      summary: string;
      beforeTokens: number;
      afterTokens: number;
      summarizedMessages: number;
      keptMessages: number;
    }>
  ): void {
    this.runners.compact = handler;
  }

  markChatBusy(chatId: string, busy: boolean): void {
    if (busy) {
      this.running.add(chatId);
    } else {
      this.running.delete(chatId);
    }
  }
}

function makeUserMessage(text: string, timestamp: number): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp
  } as AgentMessage;
}

function makeAssistantMessage(text: string, timestamp: number, totalTokens = 0): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: totalTokens,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop"
  } as AgentMessage;
}

function createTempPaths(): { root: string; restore: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-idle-compaction-"));
  const originals = { ...storagePaths };
  storagePaths.dataDir = root;
  storagePaths.sessionsDir = path.join(root, "sessions");
  storagePaths.projectsDir = path.join(root, "projects");
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "db", "settings.sqlite");
  return {
    root,
    restore: () => {
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("inspectIdleCompactionCandidate is read-only for missing sessions and counts messages after compaction", () => {
  const env = createTempPaths();
  try {
    const workspaceDir = agentWorkspaceDir(env.root, "default");
    const store = new MomRuntimeStore(workspaceDir, {
      source: { channel: "feishu", botId: "fs-1" }
    });

    const missing = store.inspectIdleCompactionCandidate("oc_missing", "session-none");
    assert.deepEqual(missing, {
      exists: false,
      lastActivityMs: 0,
      messagesSinceCompaction: 0,
      estimatedContextTokens: 0
    });
    assert.equal(existsSync(path.join(workspaceDir, "contexts", "session-none.jsonl")), false);
    assert.equal(existsSync(path.join(workspaceDir, "contexts", "session-none.meta.json")), false);

    const t0 = Date.now() - 120_000;
    store.appendContextMessage("oc_1", makeUserMessage("第一轮问题", t0), "session-1");
    store.appendContextMessage("oc_1", makeAssistantMessage("第一轮回答", t0 + 1000, 1200), "session-1");
    store.appendContextMessage("oc_1", makeUserMessage("第二轮问题", t0 + 2000), "session-1");
    store.appendContextMessage("oc_1", makeAssistantMessage("第二轮回答", t0 + 3000, 5200), "session-1");

    const beforeCompact = store.inspectIdleCompactionCandidate("oc_1", "session-1");
    assert.equal(beforeCompact.exists, true);
    assert.equal(beforeCompact.lastActivityMs, t0 + 3000);
    assert.equal(beforeCompact.messagesSinceCompaction, 4);
    assert.equal(beforeCompact.estimatedContextTokens >= 5200, true);

    const kept = [makeUserMessage("第二轮问题", t0 + 2000), makeAssistantMessage("第二轮回答", t0 + 3000, 5200)];
    store.appendCompaction("oc_1", "摘要", kept, 5200, 1500, 2, "manual", "session-1");

    const rightAfterCompact = store.inspectIdleCompactionCandidate("oc_1", "session-1");
    assert.equal(rightAfterCompact.exists, true);
    assert.equal(rightAfterCompact.messagesSinceCompaction, 0);
    assert.equal(rightAfterCompact.estimatedContextTokens, 0);

    const tAfter = Date.now() + 60_000;
    store.appendContextMessage("oc_1", makeUserMessage("压缩后新问题", tAfter), "session-1");
    store.appendContextMessage("oc_1", makeAssistantMessage("压缩后新回答", tAfter + 1000, 4600), "session-1");

    const afterNewTurn = store.inspectIdleCompactionCandidate("oc_1", "session-1");
    assert.equal(afterNewTurn.messagesSinceCompaction, 2);
    assert.equal(afterNewTurn.lastActivityMs, tAfter + 1000);
    assert.equal(afterNewTurn.estimatedContextTokens >= 4600, true);
  } finally {
    env.restore();
  }
});

test("BaseChannelRuntime.runIdleCompactionSweep honors channel defaults, thresholds, busy locks, and idempotency", async () => {
  const env = createTempPaths();
  try {
    const settings: RuntimeSettings = {
      ...structuredClone(defaultRuntimeSettings),
      channels: {
        ...defaultRuntimeSettings.channels,
        feishu: {
          instances: [
            {
              id: "fs-1",
              name: "FS Bot",
              enabled: true,
              agentId: "default",
              credentials: { appId: "cli_fs" },
              allowedChatIds: []
            }
          ]
        },
        telegram: {
          instances: [
            {
              id: "tg-1",
              name: "TG Bot",
              enabled: true,
              agentId: "default",
              credentials: { token: "tg_tok" },
              allowedChatIds: []
            }
          ]
        }
      }
    };

    const workspaceDir = agentWorkspaceDir(env.root, "default");
    const compactCalls: Array<{ channel: string; chatId: string; sessionId: string; reason?: string }> = [];

    const feishuRuntime = new TestChannelRuntime({
      channel: "feishu",
      instanceId: "fs-1",
      workspaceDir,
      getSettings: () => settings
    });
    const feishuStore = feishuRuntime.getRuntimeStore();

    feishuRuntime.stubCompact(async (chatId, sessionId, options) => {
      compactCalls.push({ channel: "feishu", chatId, sessionId, reason: options?.reason });
      const ts = Date.UTC(2026, 10, 14, 1, 0, 0);
      feishuStore.appendCompaction(
        chatId,
        "摘要内容",
        [makeUserMessage("最近问题", ts), makeAssistantMessage("最近回答", ts + 1000, 4800)],
        4800,
        1400,
        2,
        "manual",
        sessionId
      );
      return {
        changed: true,
        summary: "摘要内容",
        beforeTokens: 4800,
        afterTokens: 1400,
        summarizedMessages: 2,
        keptMessages: 2
      };
    });

    const nowMs = Date.now();
    const tIdle = nowMs - 65 * 60_000;
    // Eligible session: idle >= 60m, tokens >= 4000, >= 2 messages.
    feishuStore.appendContextMessage("oc_ready", makeUserMessage("体育新闻总结", tIdle), "s-ready");
    feishuStore.appendContextMessage("oc_ready", makeAssistantMessage("昨天体育详情", tIdle + 1000, 4800), "s-ready");
    feishuStore.setActiveSession("oc_ready", "s-ready");

    // Below minContextTokens (< 4000).
    feishuStore.appendContextMessage("oc_small", makeUserMessage("hi", tIdle), "s-small");
    feishuStore.appendContextMessage("oc_small", makeAssistantMessage("hello", tIdle + 1000, 600), "s-small");
    feishuStore.setActiveSession("oc_small", "s-small");

    // Not idle long enough (only 20m old).
    const tRecent = nowMs - 20 * 60_000;
    feishuStore.appendContextMessage("oc_fresh", makeUserMessage("刚刚聊的话题", tRecent), "s-fresh");
    feishuStore.appendContextMessage("oc_fresh", makeAssistantMessage("刚刚回复", tRecent + 1000, 5500), "s-fresh");
    feishuStore.setActiveSession("oc_fresh", "s-fresh");

    // Busy chat currently running a turn.
    feishuStore.appendContextMessage("oc_busy", makeUserMessage("忙碌会话", tIdle), "s-busy");
    feishuStore.appendContextMessage("oc_busy", makeAssistantMessage("忙碌回答", tIdle + 1000, 5500), "s-busy");
    feishuStore.setActiveSession("oc_busy", "s-busy");
    feishuRuntime.markChatBusy("oc_busy", true);

    // Telegram defaults to disabled.
    const telegramRuntime = new TestChannelRuntime({
      channel: "telegram",
      instanceId: "tg-1",
      workspaceDir,
      getSettings: () => settings
    });
    const tgStore = telegramRuntime.getRuntimeStore();
    telegramRuntime.stubCompact(async (chatId, sessionId, options) => {
      compactCalls.push({ channel: "telegram", chatId, sessionId, reason: options?.reason });
      return { changed: true, summary: "", beforeTokens: 5000, afterTokens: 1500, summarizedMessages: 2, keptMessages: 2 };
    });
    tgStore.appendContextMessage("tg_chat", makeUserMessage("TG long msg", tIdle), "s-tg");
    tgStore.appendContextMessage("tg_chat", makeAssistantMessage("TG long reply", tIdle + 1000, 6000), "s-tg");
    tgStore.setActiveSession("tg_chat", "s-tg");

    // Web is always disabled even if an instance override exists.
    const webRuntime = new TestChannelRuntime({
      channel: "web",
      instanceId: "web-1",
      workspaceDir,
      getSettings: () => ({
        ...settings,
        channels: {
          ...settings.channels,
          web: {
            instances: [
              {
                id: "web-1",
                name: "Desktop",
                enabled: true,
                agentId: "default",
                credentials: {},
                allowedChatIds: [],
                idleCompaction: { enabled: true, idleMinutes: 5, minContextTokens: 500 }
              }
            ]
          }
        }
      })
    });
    webRuntime.stubCompact(async (chatId, sessionId, options) => {
      compactCalls.push({ channel: "web", chatId, sessionId, reason: options?.reason });
      return { changed: true, summary: "", beforeTokens: 5000, afterTokens: 1500, summarizedMessages: 2, keptMessages: 2 };
    });

    const firstFeishu = await feishuRuntime.runIdleCompactionSweep(nowMs);
    const firstTelegram = await telegramRuntime.runIdleCompactionSweep(nowMs);
    const firstWeb = await webRuntime.runIdleCompactionSweep(nowMs);

    assert.equal(firstFeishu.compacted, 1);
    assert.equal(firstTelegram.compacted, 0);
    assert.equal(firstWeb.compacted, 0);
    assert.deepEqual(compactCalls, [
      { channel: "feishu", chatId: "oc_ready", sessionId: "s-ready", reason: "manual" }
    ]);

    // Running again shortly after compaction skips s-ready (idempotent) while oc_fresh is still in cooldown.
    const secondFeishu = await feishuRuntime.runIdleCompactionSweep(nowMs + 5 * 60_000);
    assert.equal(secondFeishu.compacted, 0);
    assert.equal(compactCalls.length, 1);

    // Once oc_fresh reaches 80m idle, it compacts once while s-ready stays compacted.
    const thirdFeishu = await feishuRuntime.runIdleCompactionSweep(nowMs + 60 * 60_000);
    assert.equal(thirdFeishu.compacted, 1);
    assert.deepEqual(compactCalls, [
      { channel: "feishu", chatId: "oc_ready", sessionId: "s-ready", reason: "manual" },
      { channel: "feishu", chatId: "oc_fresh", sessionId: "s-fresh", reason: "manual" }
    ]);
  } finally {
    env.restore();
  }
});
