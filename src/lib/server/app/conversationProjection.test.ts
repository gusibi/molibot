import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionMessageEntry } from "$lib/server/agent/session/session.js";
import { projectConversationMessages } from "./conversationProjection.js";

function entry(id: string, role: "user" | "assistant" | "toolResult", content: unknown, minute: number): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: `2026-07-14T10:${String(minute).padStart(2, "0")}:00.000Z`,
    message: { role, content, timestamp: Date.parse(`2026-07-14T10:${String(minute).padStart(2, "0")}:00.000Z`) } as AgentMessage
  };
}

function assistantEntry(
  id: string,
  content: unknown,
  minute: number,
  details: Record<string, unknown>
): SessionMessageEntry {
  const base = entry(id, "assistant", content, minute);
  return { ...base, message: { ...base.message, ...details } as AgentMessage };
}

test("projects provider errors and completed replies from their Agent messages", () => {
  const error = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u-error", "user", [{ type: "text", text: "hello" }], 0),
      assistantEntry("a-error", [{ type: "text", text: "" }], 1, {
        provider: "custom-ais",
        model: "llm-gateway--kimi-k3",
        stopReason: "error",
        errorMessage: "400: reasoning_effort is invalid"
      })
    ],
    metadata: [
      { id: "m-user", conversationId: "session", role: "user", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: true },
      { id: "m-error", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:01:00.000Z", contextBacked: true }
    ]
  });

  assert.equal(error.messages[1]?.content, "400: reasoning_effort is invalid");
  assert.equal(error.messages[1]?.model, "custom-ais/llm-gateway--kimi-k3");

  const completed = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u-stop", "user", [{ type: "text", text: "verify" }], 2),
      assistantEntry("a-stop", [
        { type: "thinking", thinking: "All verified." },
        { type: "text", text: "全部验证通过，接入完成！" }
      ], 3, {
        provider: "custom-ais",
        model: "llm-gateway--kimi-k3",
        stopReason: "stop"
      })
    ],
    metadata: [
      { id: "m-user-stop", conversationId: "session", role: "user", createdAt: "2026-07-14T10:02:00.000Z", contextBacked: true },
      { id: "m-stop", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:03:00.000Z", contextBacked: true }
    ]
  });

  assert.equal(completed.messages[1]?.content, "全部验证通过，接入完成！");
  assert.equal(completed.messages[1]?.thinking, "All verified.");
});

test("projects Agent content through UI-only metadata without duplicating text", () => {
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u-agent", "user", [{ type: "text", text: "hello" }], 0),
      entry("a-tool", "assistant", [{ type: "thinking", thinking: "inspect" }, { type: "toolCall", id: "t" }], 1),
      entry("tool", "toolResult", [{ type: "text", text: "secret tool output" }], 2),
      entry("a-final", "assistant", [{ type: "text", text: "hello back" }], 3)
    ],
    metadata: [
      { id: "u-ui", conversationId: "session", role: "user", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: true },
      { id: "a-ui", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:03:00.000Z", model: "openai/gpt-5", activities: [{ key: "t", kind: "tool", label: "Read", state: "success" }], contextBacked: true }
    ]
  });
  assert.deepEqual(result.messages.map((message) => [message.id, message.role, message.content]), [
    ["u-ui", "user", "hello"],
    ["a-ui", "assistant", "hello back"]
  ]);
  assert.equal(result.messages[1]?.thinking, "inspect");
  assert.equal(result.messages[1]?.activities?.[0]?.label, "Read");
  assert.equal(result.sourceEntryByMessageId.get("u-ui"), "u-agent");
});

test("migrates matching legacy text but preserves unmatched display-only commands", () => {
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [entry("u-agent", "user", [{ type: "text", text: "normal question" }], 2)],
    metadata: [
      { id: "command", conversationId: "session", role: "user", content: "/help", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: false },
      { id: "command-result", conversationId: "session", role: "assistant", content: "Help text", createdAt: "2026-07-14T10:01:00.000Z", contextBacked: false },
      { id: "normal", conversationId: "session", role: "user", content: "normal question", createdAt: "2026-07-14T10:02:00.000Z", contextBacked: false }
    ]
  });
  assert.deepEqual(result.messages.map((message) => message.content), ["/help", "Help text", "normal question"]);
  assert.deepEqual(result.migratedMetadataIds, ["normal"]);
});

test("does not migrate an old display-only message that happens to match later Agent content", () => {
  const later = entry("later", "user", [{ type: "text", text: "/help" }], 30);
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [later],
    metadata: [
      { id: "command", conversationId: "session", role: "user", content: "/help", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: false }
    ]
  });
  assert.equal(result.migratedMetadataIds.length, 0);
  assert.deepEqual(result.messages.map((message) => message.content), ["/help", "/help"]);
});

test("keeps replies paired with their turn when a legacy row breaks 1:1 alignment", () => {
  // Regression: a pre-migration display-only assistant row (contextBacked=false,
  // its own content) sits among context-backed rows. The old first-unused match
  // let later replies steal earlier Agent rows, so the last two turns rendered as
  // user, user, AI, AI with stale bodies. Order-respecting matching must keep
  // "开始生成图片" -> "图片完成B" and "帮我返回文案" -> "文字稿C".
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u1", "user", [{ type: "text", text: "现在开始第二篇" }], 0),
      entry("a1", "assistant", [{ type: "text", text: "第2篇完成A" }], 1),
      entry("u2", "user", [{ type: "text", text: "开始生成图片" }], 2),
      entry("a2", "assistant", [{ type: "text", text: "图片完成B" }], 3),
      entry("u3", "user", [{ type: "text", text: "帮我返回文案" }], 4),
      entry("a3", "assistant", [{ type: "text", text: "文字稿C" }], 5)
    ],
    metadata: [
      { id: "m-u1", conversationId: "session", role: "user", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: true },
      { id: "m-legacy", conversationId: "session", role: "assistant", content: "不同的旧文案", createdAt: "2026-07-14T10:01:00.000Z", contextBacked: false },
      { id: "m-u2", conversationId: "session", role: "user", createdAt: "2026-07-14T10:02:00.000Z", contextBacked: true },
      { id: "m-a2", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:03:00.000Z", contextBacked: true },
      { id: "m-u3", conversationId: "session", role: "user", createdAt: "2026-07-14T10:04:00.000Z", contextBacked: true },
      { id: "m-a3", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:05:00.000Z", contextBacked: true }
    ]
  });
  assert.deepEqual(result.messages.map((message) => [message.role, message.content]), [
    ["user", "现在开始第二篇"],
    ["assistant", "不同的旧文案"], // the legacy display-only row, never stolen by a later reply
    ["assistant", "第2篇完成A"],   // unmatched Agent row for the legacy turn, kept in place
    ["user", "开始生成图片"],
    ["assistant", "图片完成B"],
    ["user", "帮我返回文案"],
    ["assistant", "文字稿C"]
  ]);
  // The two context-backed replies resolve to their true Agent entries for persistence.
  assert.equal(new Map(result.resolvedSourceEntries.map((e) => [e.id, e.sourceEntryId])).get("m-a2"), "a2");
  assert.equal(new Map(result.resolvedSourceEntries.map((e) => [e.id, e.sourceEntryId])).get("m-a3"), "a3");
});

test("pairs by stored sourceEntryId regardless of list position", () => {
  // Once persisted, a stored sourceEntryId is authoritative even if a same-role
  // row appears earlier in the scan window.
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u1", "user", [{ type: "text", text: "hi" }], 0),
      entry("a-early", "assistant", [{ type: "text", text: "early reply" }], 1),
      entry("a-late", "assistant", [{ type: "text", text: "late reply" }], 3)
    ],
    metadata: [
      { id: "m-u1", conversationId: "session", role: "user", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: true },
      { id: "m-a", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:03:00.000Z", contextBacked: true, sourceEntryId: "a-late" }
    ]
  });
  const paired = result.messages.find((message) => message.id === "m-a");
  assert.equal(paired?.content, "late reply");
  // Stored id already matched, so nothing new to persist for that row.
  assert.equal(result.resolvedSourceEntries.some((e) => e.id === "m-a"), false);
});

test("preserves multiple terminal assistant replies from the same user turn", () => {
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u", "user", [{ type: "text", text: "完成这个任务" }], 0),
      assistantEntry("a-primary", [{ type: "text", text: "完整交付报告" }], 1, { stopReason: "stop" }),
      assistantEntry("a-progress", [
        { type: "thinking", thinking: "A queued runtime follow-up arrived." },
        { type: "text", text: "处理中间状态" },
        { type: "toolCall", id: "call-1" }
      ], 2, { stopReason: "toolUse" }),
      entry("tool", "toolResult", [{ type: "text", text: "done" }], 3),
      assistantEntry("a-supplement", [{ type: "text", text: "补充收尾说明" }], 4, { stopReason: "stop" })
    ],
    metadata: [
      { id: "m-u", conversationId: "session", role: "user", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: true },
      { id: "m-a", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:04:00.000Z", contextBacked: true, sourceEntryId: "a-supplement" }
    ]
  });

  assert.deepEqual(
    result.messages
      .filter((message) => message.role === "assistant")
      .map((message) => [result.sourceEntryByMessageId.get(message.id), message.content]),
    [
      ["a-primary", "完整交付报告"],
      ["a-supplement", "补充收尾说明"]
    ]
  );
});

test("an aborted trailing entry never overwrites the answer the same turn produced", () => {
  // Regression: a run that answered, then kept using tools and was killed by
  // the tool-failure budget, ends with `content: []` + errorMessage. The old
  // projection let that error stand in as content and clobber the real reply,
  // so the transcript showed nothing but "Request aborted".
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u", "user", [{ type: "text", text: "创建一个记账小程序" }], 0),
      assistantEntry("a-text", [{ type: "text", text: "已创建 expense-tracker。" }], 1, { stopReason: "stop" }),
      assistantEntry("a-tool", [{ type: "toolCall", id: "call-1" }], 2, { stopReason: "toolUse" }),
      assistantEntry("a-abort", [], 3, { stopReason: "aborted", errorMessage: "Request aborted" })
    ],
    metadata: [
      { id: "m-u", conversationId: "session", role: "user", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: true },
      { id: "m-a", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:03:00.000Z", contextBacked: true, sourceEntryId: "a-abort" }
    ]
  });

  const reply = result.messages.find((message) => message.id === "m-a");
  assert.equal(reply?.content, "已创建 expense-tracker。");
  // The failure is still reported — as status beside the answer, not instead of it.
  assert.equal(reply?.stopReason, "aborted");
  assert.equal(reply?.errorMessage, "Request aborted");
});

test("a turn with no text at all still shows its error as the bubble body", () => {
  const result = projectConversationMessages({
    conversationId: "session",
    entries: [
      entry("u", "user", [{ type: "text", text: "hi" }], 0),
      assistantEntry("a-fail", [], 1, { stopReason: "error", errorMessage: "401: invalid api key" })
    ],
    metadata: [
      { id: "m-u", conversationId: "session", role: "user", createdAt: "2026-07-14T10:00:00.000Z", contextBacked: true },
      { id: "m-a", conversationId: "session", role: "assistant", createdAt: "2026-07-14T10:01:00.000Z", contextBacked: true }
    ]
  });
  assert.equal(result.messages.find((message) => message.id === "m-a")?.content, "401: invalid api key");
});
