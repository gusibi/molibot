import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";

function makeStore(): { store: MomRuntimeStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "molibot-ctx-checkpoint-"));
  return { store: new MomRuntimeStore(dir), dir };
}

function textMessage(role: string, text: string): AgentMessage {
  return { role, content: [{ type: "text", text }], timestamp: Date.now() } as unknown as AgentMessage;
}

const CHAT = "chat1";
const SID = "s-test";

test("restoreContextCheckpoint drops a failed attempt's persisted steps in lockstep", () => {
  const { store, dir } = makeStore();
  try {
    // The user prompt is persisted before the attempt runs.
    store.appendContextMessage(CHAT, textMessage("user", "hi"), SID);
    const checkpoint = store.createContextCheckpoint(CHAT, SID);

    // A failed attempt: message_end persists an assistant turn + a tool result.
    store.appendContextMessage(CHAT, textMessage("assistant", "let me call a tool"), SID);
    store.appendContextMessage(CHAT, textMessage("toolResult", "tool output"), SID);
    assert.equal(store.loadContext(CHAT, SID).length, 3);

    // Rolling back to the checkpoint removes exactly the two dead steps.
    const dropped = store.restoreContextCheckpoint(CHAT, checkpoint, SID);
    assert.equal(dropped, 2);
    const afterRollback = store.loadContext(CHAT, SID);
    assert.equal(afterRollback.length, 1);
    assert.equal((afterRollback[0] as { role?: string }).role, "user");

    // The retry re-persists cleanly: no duplicate assistant/toolResult steps.
    store.appendContextMessage(CHAT, textMessage("assistant", "final answer"), SID);
    const afterRetry = store.loadContext(CHAT, SID);
    assert.equal(afterRetry.length, 2);
    assert.deepEqual(
      afterRetry.map((m) => (m as { role?: string }).role),
      ["user", "assistant"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restoreContextCheckpoint is a no-op when nothing was appended after the checkpoint", () => {
  const { store, dir } = makeStore();
  try {
    store.appendContextMessage(CHAT, textMessage("user", "hi"), SID);
    const checkpoint = store.createContextCheckpoint(CHAT, SID);
    assert.equal(store.restoreContextCheckpoint(CHAT, checkpoint, SID), 0);
    assert.equal(store.loadContext(CHAT, SID).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restoreContextCheckpoint refuses to cross a session boundary", () => {
  const { store, dir } = makeStore();
  try {
    store.appendContextMessage(CHAT, textMessage("user", "hi"), SID);
    const checkpoint = store.createContextCheckpoint(CHAT, SID);
    store.appendContextMessage(CHAT, textMessage("assistant", "other session"), "s-other");

    // Applying the s-test checkpoint against a different session must not touch it.
    assert.equal(store.restoreContextCheckpoint(CHAT, checkpoint, "s-other"), 0);
    assert.equal(store.loadContext(CHAT, "s-other").length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The composer context panel reads this snapshot back from the entries file,
// so it must survive the JSON round-trip intact — and never leak onto the
// model context rebuild (`loadContext` reads `entry.message` only).
test("appendContextMessage persists the context snapshot on the entry", () => {
  const { store, dir } = makeStore();
  try {
    const snapshot = {
      contextWindow: 100_000,
      estimatedTokens: 1_234,
      breakdown: { messages: 900, mcpTools: 200, systemTools: 80, systemPrompt: 40, skills: 10, other: 4 },
      inputTokens: 1_100,
      cacheReadTokens: 200,
      cacheWriteTokens: 30
    };
    store.appendContextMessage(CHAT, textMessage("user", "hi"), SID);
    store.appendContextMessage(CHAT, textMessage("assistant", "done"), SID, { contextBreakdown: snapshot });

    const [userEntry, assistantEntry] = store.listSessionMessageEntries(CHAT, SID);
    assert.equal(userEntry.contextBreakdown, undefined);
    assert.deepEqual(assistantEntry.contextBreakdown, snapshot);

    // The model context rebuild carries the messages only.
    assert.deepEqual(store.loadContext(CHAT, SID).map((m) => (m as { role?: string }).role), ["user", "assistant"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discardLatestContextAssistant preserves completed tool results", () => {
  const { store, dir } = makeStore();
  try {
    store.appendContextMessage(CHAT, {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "write", arguments: { path: "out.txt" } }],
      stopReason: "toolUse",
      timestamp: Date.now()
    } as any, SID);
    store.appendContextMessage(CHAT, {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "write",
      content: [{ type: "text", text: "wrote out.txt" }],
      isError: false,
      timestamp: Date.now()
    } as any, SID);
    store.appendContextMessage(CHAT, {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "context length exceeded",
      timestamp: Date.now()
    } as any, SID);

    assert.equal(store.discardLatestContextAssistant(CHAT, SID), true);
    const context = store.loadContext(CHAT, SID);
    assert.deepEqual(context.map((message) => message.role), ["assistant", "toolResult"]);
    assert.equal(JSON.stringify(context).includes("context length exceeded"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
