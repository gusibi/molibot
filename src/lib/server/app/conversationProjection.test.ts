import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
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
