import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { compactContextMessages, shouldCompactContext } from "$lib/server/agent/session/compaction.js";

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

test("shouldCompactContext disabled returns false", () => {
  const settings = { enabled: false, thresholdPercent: 10, reserveTokens: 1024, keepRecentTokens: 2048, defaultContextWindow: 200000 };
  const hugeMessages = [{ role: "user", content: "x".repeat(1000000), timestamp: 0 }] as AgentMessage[];

  assert.equal(shouldCompactContext(hugeMessages, 200000, settings), false);
});
