import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ConversationMessage } from "$lib/shared/types/message";
import { attachContextThinking } from "./conversationThinking.js";

test("attachContextThinking aggregates reasoning across tool calls into the matching Desktop reply", () => {
  const messages: ConversationMessage[] = [
    { id: "u1", conversationId: "s1", role: "user", content: "生成图片", createdAt: "2026-07-01T00:00:00Z" },
    { id: "a1", conversationId: "s1", role: "assistant", content: "图片完成", createdAt: "2026-07-01T00:01:00Z" },
    { id: "u2", conversationId: "s1", role: "user", content: "重新生成一张", createdAt: "2026-07-06T00:00:00Z" },
    { id: "a2", conversationId: "s1", role: "assistant", content: "新图片完成", createdAt: "2026-07-06T00:01:00Z" }
  ];
  const context: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "生成图片" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "thinking", thinking: "先选择工具" }, { type: "toolCall", id: "t1", name: "toolSearch", arguments: {} }], api: "openai-completions", provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 2 },
    { role: "toolResult", toolCallId: "t1", toolName: "toolSearch", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 },
    { role: "assistant", content: [{ type: "thinking", thinking: "再生成图片" }, { type: "text", text: "图片完成" }], api: "openai-completions", provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 4 },
    { role: "user", content: [{ type: "text", text: "重新生成一张" }], timestamp: 5 },
    { role: "assistant", content: [{ type: "thinking", thinking: "使用新的随机种子" }, { type: "text", text: "新图片完成" }], api: "openai-completions", provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 6 }
  ];

  const enriched = attachContextThinking(messages, context);

  assert.equal(enriched[1]?.thinking, "先选择工具\n\n再生成图片");
  assert.equal(enriched[3]?.thinking, "使用新的随机种子");
  assert.equal("thinking" in (messages[1] ?? {}), false, "the stored session projection must not be mutated");
});

test("attachContextThinking skips compacted context turns that do not match the Desktop user message", () => {
  const messages: ConversationMessage[] = [
    { id: "u1", conversationId: "s1", role: "user", content: "真实问题", createdAt: "2026-07-01T00:00:00Z" },
    { id: "a1", conversationId: "s1", role: "assistant", content: "真实回答", createdAt: "2026-07-01T00:01:00Z" }
  ];
  const context = [
    { role: "user", content: "[context summary]\n旧摘要", timestamp: 1 },
    { role: "assistant", content: [{ type: "thinking", thinking: "摘要后的内部推理" }, { type: "text", text: "摘要回答" }], timestamp: 2 },
    { role: "user", content: [{ type: "text", text: "真实问题" }], timestamp: 3 },
    { role: "assistant", content: [{ type: "thinking", thinking: "匹配到真实问题" }, { type: "text", text: "真实回答" }], timestamp: 4 }
  ] as AgentMessage[];

  assert.equal(attachContextThinking(messages, context)[1]?.thinking, "匹配到真实问题");
});
