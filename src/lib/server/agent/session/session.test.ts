import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  stripTransientRuntimeNoticesFromMessages,
  SUBAGENT_DELEGATION_RUNTIME_NOTICE,
  TOOL_BUDGET_RUNTIME_NOTICE
} from "$lib/server/agent/core/runtimeNotices.js";
import { buildMessagesFromSessionEntries, createSessionHeader, type SessionFileEntry } from "$lib/server/agent/session/session.js";

test("runtime event entries stay out of rebuilt model messages", () => {
  const assistant: AgentMessage = {
    role: "assistant",
    content: [{ type: "text", text: "final answer" }],
    timestamp: Date.now()
  } as any;
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

test("turn-only entries remain in the transcript log but not future Agent Context", () => {
  const entries: SessionFileEntry[] = [
    createSessionHeader("session-retention"),
    { type: "message", id: "u1", parentId: null, timestamp: "2026-08-09T00:00:00.000Z", retention: "turn_only", message: { role: "user", content: "TMP-4821", timestamp: 1 } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-09T00:00:01.000Z", retention: "turn_only", message: { role: "assistant", content: [{ type: "text", text: "收到" }], timestamp: 2 } as any },
    { type: "message", id: "u2", parentId: "a1", timestamp: "2026-08-09T00:00:02.000Z", retention: "standard", message: { role: "user", content: "下一轮", timestamp: 3 } }
  ];
  assert.equal(entries.filter((entry) => entry.type === "message").length, 3);
  assert.deepEqual(buildMessagesFromSessionEntries(entries).messages.map((message) => message.role), ["user"]);
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
    } as any
  ];

  const stripped = stripTransientRuntimeNoticesFromMessages(messages);
  assert.equal(stripped.length, 1);
  assert.equal((stripped[0] as { role?: string }).role, "assistant");
});

test("transient subagent delegation runtime notice is stripped from prompt history", () => {
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: SUBAGENT_DELEGATION_RUNTIME_NOTICE }],
      timestamp: Date.now()
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "delegating now" }],
      timestamp: Date.now()
    } as any
  ];

  const stripped = stripTransientRuntimeNoticesFromMessages(messages);
  assert.equal(stripped.length, 1);
  assert.equal((stripped[0] as { role?: string }).role, "assistant");
});
