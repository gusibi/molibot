import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { MomRuntimeStore } from "./store.js";

function message(role: "user" | "assistant", text: string): AgentMessage {
  return { role, content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

test("conversation projection entries stay stable and edit truncation rebuilds context", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-conversation-entries-"));
  try {
    const store = new MomRuntimeStore(dir);
    const chatId = "web:default:web-anonymous";
    const sessionId = "session";
    store.appendContextMessage(chatId, message("user", "first"), sessionId);
    store.appendContextMessage(chatId, message("assistant", "answer"), sessionId);
    store.appendContextMessage(chatId, message("user", "second"), sessionId);
    store.appendContextMessage(chatId, message("assistant", "second answer"), sessionId);
    const entries = store.listSessionMessageEntries(chatId, sessionId);
    assert.equal(entries.length, 4);
    assert.equal(store.truncateSessionFromEntry(chatId, sessionId, entries[2]!.id), 2);
    assert.deepEqual(store.loadContext(chatId, sessionId).map((item) => item.role), ["user", "assistant"]);
    assert.deepEqual(store.listSessionMessageEntries(chatId, sessionId).map((item) => item.id), entries.slice(0, 2).map((item) => item.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
