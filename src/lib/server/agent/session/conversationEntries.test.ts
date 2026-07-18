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

test("shared automation archives project messages by run id and preserve legacy sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-conversation-run-entries-"));
  try {
    const store = new MomRuntimeStore(dir);
    const chatId = "web:default:web-anonymous";
    const archiveId = store.beginTaskArchiveSession(chatId, "daily-report");
    store.appendContextMessage(chatId, message("user", "first prompt"), archiveId, { runId: "run-1" });
    store.appendContextMessage(chatId, message("assistant", "first answer"), archiveId, { runId: "run-1" });
    store.appendContextMessage(chatId, message("user", "second prompt"), archiveId, { runId: "run-2" });
    store.appendContextMessage(chatId, message("assistant", "second answer"), archiveId, { runId: "run-2" });

    assert.deepEqual(
      store.loadContextForRun(chatId, archiveId, "run-2").map((item) => item.role === "assistant" ? "assistant" : "user"),
      ["user", "assistant"]
    );
    assert.match(JSON.stringify(store.loadContextForRun(chatId, archiveId, "run-2")), /second answer/);
    assert.doesNotMatch(JSON.stringify(store.loadContextForRun(chatId, archiveId, "run-2")), /first answer/);
    assert.deepEqual(store.loadContextForRun(chatId, archiveId, "missing-run"), []);

    const legacyId = store.beginTaskSession(chatId);
    store.appendContextMessage(chatId, message("user", "legacy prompt"), legacyId);
    store.appendContextMessage(chatId, message("assistant", "legacy answer"), legacyId);
    assert.match(JSON.stringify(store.loadContextForRun(chatId, legacyId, "legacy-run")), /legacy answer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shared automation approval rewrite replaces only the owning run", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-conversation-run-rewrite-"));
  try {
    const store = new MomRuntimeStore(dir);
    const chatId = "web:default:web-anonymous";
    const archiveId = store.beginTaskArchiveSession(chatId, "daily-report");
    store.appendContextMessage(chatId, message("user", "first prompt"), archiveId, { runId: "run-1" });
    store.appendContextMessage(chatId, message("assistant", "first answer"), archiveId, { runId: "run-1" });
    store.appendContextMessage(chatId, message("user", "second prompt"), archiveId, { runId: "run-2" });
    store.appendContextMessage(chatId, message("assistant", "waiting approval"), archiveId, { runId: "run-2" });

    store.replaceContextForRun(chatId, archiveId, "run-2", [
      message("user", "second prompt"),
      message("assistant", "approved output")
    ]);

    assert.match(JSON.stringify(store.loadContextForRun(chatId, archiveId, "run-1")), /first answer/);
    assert.doesNotMatch(JSON.stringify(store.loadContextForRun(chatId, archiveId, "run-1")), /approved output/);
    assert.match(JSON.stringify(store.loadContextForRun(chatId, archiveId, "run-2")), /approved output/);
    assert.doesNotMatch(JSON.stringify(store.loadContextForRun(chatId, archiveId, "run-2")), /waiting approval/);
    assert.deepEqual(
      store.listSessionMessageEntries(chatId, archiveId).map((entry) => entry.runId),
      ["run-1", "run-1", "run-2", "run-2"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
