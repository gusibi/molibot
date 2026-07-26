import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import {
  compactContextMessages,
  estimateContextTokens,
  planCompactionSpan,
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

/** Minimal StreamFn stub: records the request and replies with fixed text. */
function stubStream(options: {
  reply?: string;
  failures?: number;
  failureMessage?: string;
}) {
  const calls: Array<{ promptText: string }> = [];
  let remainingFailures = options.failures ?? 0;

  const streamFn = (async (_model: any, context: any) => {
    const promptText = context.messages
      .flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("\n");
    calls.push({ promptText });

    if (remainingFailures > 0) {
      remainingFailures -= 1;
      throw new Error(options.failureMessage ?? "503 temporarily unavailable");
    }

    return {
      result: async () => ({
        role: "assistant",
        content: [{ type: "text", text: options.reply ?? "## Summary\n- done" }],
        stopReason: "stop",
        usage: { input: 10, output: 5 },
        timestamp: Date.now()
      })
    };
  }) as any;

  return { streamFn, calls };
}

const longHistory = (): AgentMessage[] => [
  textMessage("user", "A".repeat(12000)),
  textMessage("assistant", "B".repeat(12000)),
  textMessage("user", "C".repeat(12000)),
  textMessage("assistant", "D".repeat(12000))
];

test("compaction uses the model summary when the provider succeeds", async () => {
  const { streamFn, calls } = stubStream({ reply: "## Summary\n- refactored the parser" });

  const result = await compactContextMessages({
    messages: longHistory(),
    model: { provider: "test", id: "test-model" } as any,
    settings: { ...defaultRuntimeSettings.compaction, keepRecentTokens: 200000 },
    reason: "manual",
    streamFn
  });

  assert.equal(calls.length, 1);
  assert.equal(result.summary, "## Summary\n- refactored the parser");
  const summaryMessage = result.messages[0] as unknown as { content: string };
  assert.match(summaryMessage.content, /^\[context summary\]/);
});

test("a prior summary is merged rather than re-summarized as raw text", async () => {
  const { streamFn, calls } = stubStream({});
  const messages: AgentMessage[] = [
    { role: "user", content: "[context summary]\n## Summary\n- earlier work", timestamp: Date.now() } as AgentMessage,
    ...longHistory()
  ];

  await compactContextMessages({
    messages,
    model: { provider: "test", id: "test-model" } as any,
    settings: { ...defaultRuntimeSettings.compaction, keepRecentTokens: 200000 },
    reason: "manual",
    streamFn
  });

  assert.equal(calls.length, 1);
  const prompt = calls[0].promptText;
  assert.match(prompt, /<previous-summary>/, "the prior summary must be passed as a summary to update");
  assert.match(prompt, /- earlier work/);
  assert.doesNotMatch(
    prompt.split("<previous-summary>")[0],
    /\[context summary\]/,
    "the prior summary must not also appear inside the conversation body"
  );
});

test("a transient summarization failure is retried", async () => {
  const { streamFn, calls } = stubStream({ failures: 1, reply: "## Summary\n- second attempt" });

  const result = await compactContextMessages({
    messages: longHistory(),
    model: { provider: "test", id: "test-model" } as any,
    settings: { ...defaultRuntimeSettings.compaction, keepRecentTokens: 200000 },
    reason: "manual",
    streamFn
  });

  assert.equal(calls.length, 2, "the retryable failure must be retried");
  assert.equal(result.summary, "## Summary\n- second attempt");
});

test("a permanent summarization failure is not retried and falls back", async () => {
  const { streamFn, calls } = stubStream({ failures: 99, failureMessage: "400 invalid request" });

  const result = await compactContextMessages({
    messages: longHistory(),
    model: { provider: "test", id: "test-model" } as any,
    settings: { ...defaultRuntimeSettings.compaction, keepRecentTokens: 200000 },
    reason: "manual",
    streamFn
  });

  assert.equal(calls.length, 1, "a non-retryable error must not be retried");
  assert.equal(result.changed, true);
  assert.match(result.summary, /Summary/, "compaction must still produce a fallback summary");
});

test("the summarization request stays bounded for very long histories", async () => {
  const { streamFn, calls } = stubStream({});
  const huge: AgentMessage[] = [];
  for (let i = 0; i < 60; i += 1) {
    huge.push(textMessage(i % 2 === 0 ? "user" : "assistant", `${i}:`.padEnd(8000, "x")));
  }
  huge.push(textMessage("user", "tail"));

  await compactContextMessages({
    messages: huge,
    model: { provider: "test", id: "test-model" } as any,
    settings: { ...defaultRuntimeSettings.compaction, keepRecentTokens: 1000 },
    reason: "manual",
    streamFn
  });

  assert.equal(calls.length, 1);
  assert.ok(
    calls[0].promptText.length < 200000,
    `summarization prompt must stay bounded, got ${calls[0].promptText.length} chars`
  );
});

function toolCallMessage(id: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "bash", arguments: { command: "ls" } }],
    timestamp: Date.now()
  } as unknown as AgentMessage;
}

function toolResultMessage(id: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    content: [{ type: "text", text }],
    timestamp: Date.now()
  } as unknown as AgentMessage;
}

test("the kept slice never starts on a tool result, so no orphan survives compaction", async () => {
  // The budget boundary is engineered to land on the tool result: everything
  // before it is large, and the tool result plus the trailing turn fit the
  // keep-recent window while the assistant tool call that produced it does not.
  const messages = [
    textMessage("user", "A".repeat(40000)),
    textMessage("assistant", "B".repeat(40000)),
    toolCallMessage("call-1"),
    toolResultMessage("call-1", "C".repeat(3000)),
    textMessage("assistant", "D".repeat(1000)),
    textMessage("user", "E".repeat(500))
  ];

  const result = await compactContextMessages({
    messages,
    model: { provider: "test", id: "test-model" } as any,
    settings: {
      ...defaultRuntimeSettings.compaction,
      keepRecentTokens: 1200
    },
    reason: "threshold",
    streamFn: (async () => {
      throw new Error("summarization is not under test here");
    }) as any
  });

  assert.equal(result.changed, true);
  const firstKept = result.messages[1] as { role?: string };
  assert.notEqual(firstKept.role, "toolResult");

  // Every retained tool result still has its tool call in front of it.
  const retainedCallIds = new Set<string>();
  for (const message of result.messages) {
    const row = message as { role?: string; toolCallId?: string; content?: Array<{ type?: string; id?: string }> };
    if (row.role === "assistant" && Array.isArray(row.content)) {
      for (const part of row.content) {
        if (part?.type === "toolCall" && part.id) retainedCallIds.add(part.id);
      }
    }
    if (row.role === "toolResult") {
      assert.equal(retainedCallIds.has(String(row.toolCallId)), true);
    }
  }
});

test("a cut on a turn boundary is not treated as a split turn", () => {
  const messages = [
    textMessage("user", "one"),
    textMessage("assistant", "reply"),
    textMessage("user", "two"),
    textMessage("assistant", "reply")
  ];

  const span = planCompactionSpan(messages, 2);

  assert.equal(span.isSplitTurn, false);
  assert.equal(span.historyEnd, 2);
});

test("a cut inside an oversized turn separates that turn's prefix from the older history", () => {
  const messages = [
    textMessage("user", "old turn"),
    textMessage("assistant", "old reply"),
    textMessage("user", "huge turn"),
    toolCallMessage("call-1"),
    toolResultMessage("call-1", "output"),
    textMessage("assistant", "still working")
  ];

  // Budget lands mid-turn, on the trailing assistant message.
  const span = planCompactionSpan(messages, 5);

  assert.equal(span.isSplitTurn, true);
  assert.equal(span.turnStartIndex, 2);
  // Older complete turns stop before the split turn begins.
  assert.equal(span.historyEnd, 2);
});

test("history beginning mid-turn does not report a split turn it cannot bound", () => {
  const messages = [toolCallMessage("call-1"), toolResultMessage("call-1", "out"), textMessage("assistant", "x")];

  const span = planCompactionSpan(messages, 2);

  assert.equal(span.isSplitTurn, false);
  assert.equal(span.historyEnd, 2);
});

test("a split turn produces one merged summary carrying both halves", async () => {
  const messages = [
    textMessage("user", "A".repeat(40000)),
    textMessage("assistant", "B".repeat(40000)),
    textMessage("user", "C".repeat(9000)),
    toolCallMessage("call-1"),
    toolResultMessage("call-1", "D".repeat(3000)),
    textMessage("assistant", "E".repeat(400)),
    textMessage("assistant", "F".repeat(200))
  ];

  const calls: string[] = [];
  const streamFn = (async (_model: any, context: any) => {
    const promptText = context.messages
      .flatMap((message: any) => (Array.isArray(message.content) ? message.content : []))
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("\n");
    const isPrefixPass = promptText.includes("PREFIX of a turn");
    calls.push(isPrefixPass ? "prefix" : "history");
    return {
      result: async () => ({
        role: "assistant",
        content: [{ type: "text", text: isPrefixPass ? "PREFIX-SUMMARY" : "HISTORY-SUMMARY" }],
        stopReason: "stop",
        usage: { input: 10, output: 5 },
        timestamp: Date.now()
      })
    };
  }) as any;

  const result = await compactContextMessages({
    messages,
    model: { provider: "test", id: "test-model", maxTokens: 4096 } as any,
    settings: { ...defaultRuntimeSettings.compaction, keepRecentTokens: 400 },
    reason: "threshold",
    streamFn
  });

  assert.equal(result.changed, true);
  // Two passes: the older complete turns, then the oversized turn's prefix.
  assert.deepEqual(calls, ["history", "prefix"]);
  assert.match(result.summary, /HISTORY-SUMMARY/);
  assert.match(result.summary, /Turn Context \(split turn\)/);
  assert.match(result.summary, /PREFIX-SUMMARY/);
});
