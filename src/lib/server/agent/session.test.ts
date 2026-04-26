import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { stripTransientRuntimeNoticesFromMessages, TOOL_BUDGET_RUNTIME_NOTICE } from "./runtimeNotices.js";
import { buildMessagesFromSessionEntries, createSessionHeader, type SessionFileEntry } from "./session.js";

test("runtime event entries stay out of rebuilt model messages", () => {
  const assistant: AgentMessage = {
    role: "assistant",
    content: [{ type: "text", text: "final answer" }],
    timestamp: Date.now()
  };
  const entries: SessionFileEntry[] = [
    createSessionHeader("s-test"),
    {
      type: "runtime_event",
      id: "evt1",
      parentId: null,
      timestamp: new Date().toISOString(),
      code: "RUN_TOOL_BUDGET_EXHAUSTED",
      level: "warn",
      summary: "budget hit",
      details: { reason: "Run budget exceeded" }
    },
    {
      type: "message",
      id: "msg1",
      parentId: "evt1",
      timestamp: new Date().toISOString(),
      message: assistant
    }
  ];

  const built = buildMessagesFromSessionEntries(entries);
  assert.equal(built.messages.length, 1);
  assert.deepEqual(built.messages[0], assistant);
  assert.equal(built.entries.length, 2);
  assert.equal(built.entries[0]?.type, "runtime_event");
});

test("transient tool-budget runtime notice is stripped from prompt history", () => {
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: TOOL_BUDGET_RUNTIME_NOTICE }],
      timestamp: Date.now()
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "best effort answer" }],
      timestamp: Date.now()
    }
  ];

  const stripped = stripTransientRuntimeNoticesFromMessages(messages);
  assert.equal(stripped.length, 1);
  assert.equal((stripped[0] as { role?: string }).role, "assistant");
});
