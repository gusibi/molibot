import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import {
  compactContextMessages,
  estimateContextTokens,
  resolveContextTokens,
  shouldCompactContext
} from "$lib/server/agent/session/compaction.js";

function textMessage(role: "user" | "assistant", text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }],
    timestamp: Date.now()
  } as AgentMessage;
}

test("manual compaction can force a summary below the keep-recent token window", async () => {
  const messages = [
    textMessage("user", "A".repeat(12000)),
    textMessage("assistant", "B".repeat(12000)),
    textMessage("user", "C".repeat(12000)),
    textMessage("assistant", "D".repeat(12000))
  ];

  const result = await compactContextMessages({
    messages,
    model: { provider: "test", id: "test-model" } as any,
    settings: {
      ...defaultRuntimeSettings.compaction,
      keepRecentTokens: 200000
    },
    reason: "manual"
  });

  assert.equal(result.changed, true);
  assert.equal(result.summarizedMessages, 2);
  assert.equal(result.keptMessages, 2);
});

test("threshold compaction still respects the keep-recent token window", async () => {
  const messages = [
    textMessage("user", "A".repeat(12000)),
    textMessage("assistant", "B".repeat(12000)),
    textMessage("user", "C".repeat(12000)),
    textMessage("assistant", "D".repeat(12000))
  ];

  const result = await compactContextMessages({
    messages,
    model: { provider: "test", id: "test-model" } as any,
    settings: {
      ...defaultRuntimeSettings.compaction,
      keepRecentTokens: 200000
    },
    reason: "threshold"
  });

  assert.equal(result.changed, false);
  assert.equal(result.summarizedMessages, 0);
  assert.equal(result.keptMessages, 4);
});

test("shouldCompactContext triggers at thresholdPercent", () => {
  const settings = { enabled: true, thresholdPercent: 75, reserveTokens: 8192, keepRecentTokens: 20000, defaultContextWindow: 200000 };
  const contextWindow = 200000;
  // 75% of 200k = 150k tokens threshold
  // 200k - 8192 = 191808 reserve threshold
  // min(150k, 191808) = 150k

  // estimateMessageTokens: ceil(length / 4)
  // 150k tokens = 600000 chars
  const atThreshold = [{ role: "user", content: "x".repeat(600000), timestamp: 0 }] as AgentMessage[];
  const belowThreshold = [{ role: "user", content: "x".repeat(599996), timestamp: 0 }] as AgentMessage[];

  assert.equal(shouldCompactContext(atThreshold, contextWindow, settings), true);
  assert.equal(shouldCompactContext(belowThreshold, contextWindow, settings), false);
});

test("shouldCompactContext uses reserveTokens as secondary limit", () => {
  // Low thresholdPercent (50%) should be the binding limit
  const contextWindow = 200000;
  const lowSettings = { enabled: true, thresholdPercent: 50, reserveTokens: 8192, keepRecentTokens: 20000, defaultContextWindow: 200000 };
  // 50% of 200k = 100k, 200k - 8192 = 191808 -> min = 100k
  const at100k = [{ role: "user", content: "x".repeat(400000), timestamp: 0 }] as AgentMessage[];
  const below100k = [{ role: "user", content: "x".repeat(399996), timestamp: 0 }] as AgentMessage[];

  assert.equal(shouldCompactContext(at100k, contextWindow, lowSettings), true);
  assert.equal(shouldCompactContext(below100k, contextWindow, lowSettings), false);
});

test("estimateContextTokens weights CJK characters as roughly one token each", () => {
  const ascii = [textMessage("user", "x".repeat(4000))] as AgentMessage[];
  const cjk = [textMessage("user", "中".repeat(4000))] as AgentMessage[];

  assert.equal(estimateContextTokens(ascii), 1000);
  assert.equal(estimateContextTokens(cjk), 4000);
});

test("resolveContextTokens prefers provider usage from the latest assistant response", () => {
  const assistantWithUsage = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    usage: { input: 90000, output: 500, cacheRead: 30000, cacheWrite: 0, totalTokens: 120500 },
    timestamp: 2000
  } as unknown as AgentMessage;
  const messages = [
    textMessage("user", "x".repeat(400)),
    assistantWithUsage,
    { role: "user", content: [{ type: "text", text: "y".repeat(400) }], timestamp: 3000 } as AgentMessage
  ];

  const resolved = resolveContextTokens(messages);
  assert.equal(resolved.source, "usage");
  // usage total (90000 + 30000 + 500) plus the estimate of the trailing user message
  assert.equal(resolved.tokens, 120500 + 100);
});

test("resolveContextTokens ignores usage predating the latest compaction summary", () => {
  const staleAssistant = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    usage: { input: 150000, output: 400, cacheRead: 0, cacheWrite: 0, totalTokens: 150400 },
    timestamp: 1000
  } as unknown as AgentMessage;
  const summaryMessage = {
    role: "user",
    content: "[context summary]\nEarlier conversation was compacted.",
    timestamp: 5000
  } as unknown as AgentMessage;
  const messages = [summaryMessage, staleAssistant];

  const resolved = resolveContextTokens(messages);
  assert.equal(resolved.source, "estimate");
  assert.ok(resolved.tokens < 1000);
});

test("shouldCompactContext triggers from real usage even when the char estimate is low", () => {
  const settings = { enabled: true, thresholdPercent: 75, reserveTokens: 8192, keepRecentTokens: 20000, defaultContextWindow: 200000 };
  const assistantWithUsage = {
    role: "assistant",
    content: [{ type: "text", text: "short reply" }],
    usage: { input: 160000, output: 1000, cacheRead: 0, cacheWrite: 0, totalTokens: 161000 },
    timestamp: 2000
  } as unknown as AgentMessage;
  const messages = [textMessage("user", "hello"), assistantWithUsage];

  // Char estimate is tiny, but the provider reported 161k prompt+output tokens.
  assert.equal(estimateContextTokens(messages) < 100, true);
  assert.equal(shouldCompactContext(messages, 200000, settings), true);
});

test("shouldCompactContext disabled returns false", () => {
  const settings = { enabled: false, thresholdPercent: 10, reserveTokens: 1024, keepRecentTokens: 2048, defaultContextWindow: 200000 };
  const hugeMessages = [{ role: "user", content: "x".repeat(1000000), timestamp: 0 }] as AgentMessage[];

  assert.equal(shouldCompactContext(hugeMessages, 200000, settings), false);
});
