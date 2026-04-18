import test from "node:test";
import assert from "node:assert/strict";
import { SharedRuntimeCommandService } from "./channelCommands.js";
import { defaultRuntimeSettings } from "../settings/defaults.js";

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
  assert.match(sent[0] ?? "", /Current context≈ 3,456 tokens/);
  assert.match(sent[0] ?? "", /Session token total: 181/);
  assert.match(sent[0] ?? "", /Session input\/output: 123 \/ 45/);
  assert.match(sent[0] ?? "", /Compactions: 1/);
});
