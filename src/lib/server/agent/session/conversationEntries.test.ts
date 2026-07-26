import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MomRuntimeStore } from "./store.js";

function message(role: "user" | "assistant", text: string): AgentMessage {
  return { role, content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

test("conversation projection entries stay stable across appends", () => {
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
    // Entry ids are the fork points the visible transcript maps onto, so they
    // must stay stable and ordered as the log grows.
    assert.deepEqual(new Set(entries.map((item) => item.id)).size, 4);
    assert.deepEqual(
      store.listSessionMessageEntries(chatId, sessionId).map((item) => item.id),
      entries.map((item) => item.id)
    );
    assert.deepEqual(
      store.loadContext(chatId, sessionId).map((item) => item.role),
      ["user", "assistant", "user", "assistant"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forkSessionBeforeEntry copies only the prefix and inherits preferences without session approval", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-agent-session-fork-"));
  try {
    const store = new MomRuntimeStore(dir);
    const chatId = "web:default:web-anonymous";
    const parentId = "parent";
    store.appendContextMessage(chatId, message("user", "first"), parentId);
    store.appendContextMessage(chatId, message("assistant", "answer"), parentId);
    store.appendContextMessage(chatId, message("user", "second"), parentId);
    store.appendContextMessage(chatId, message("assistant", "second answer"), parentId);
    store.setSessionThinkingLevelOverride(chatId, parentId, "high");
    store.setSessionSandboxOverride(chatId, parentId, true);
    store.setSessionHostApprovalMode(chatId, parentId, "session");
    const entries = store.listSessionMessageEntries(chatId, parentId);

    const childId = store.forkSessionBeforeEntry(chatId, parentId, entries[2]!.id, "fork-child");

    assert.equal(childId, "fork-child");
    assert.deepEqual(store.loadContext(chatId, parentId).map((item) => item.role), ["user", "assistant", "user", "assistant"]);
    assert.deepEqual(store.loadContext(chatId, childId).map((item) => item.role), ["user", "assistant"]);
    assert.deepEqual(store.listSessionMessageEntries(chatId, childId).map((entry) => entry.id), entries.slice(0, 2).map((entry) => entry.id));
    assert.equal(store.getSessionThinkingLevelOverride(chatId, childId), "high");
    assert.equal(store.getSessionSandboxOverride(chatId, childId), true);
    assert.equal(store.getSessionHostApprovalMode(chatId, childId), "default");

    const reloaded = new MomRuntimeStore(dir);
    assert.deepEqual(reloaded.loadContext(chatId, childId).map((item) => item.role), ["user", "assistant"]);
    assert.equal(reloaded.readSessionLineage(chatId, childId)?.parentSessionId, parentId);
    assert.equal(reloaded.readSessionLineage(chatId, childId)?.forkedFromEntryId, entries[2]!.id);
    assert.equal(reloaded.forkSessionBeforeEntry(chatId, parentId, entries[2]!.id, childId), childId);
    assert.equal(reloaded.listSessionMessageEntries(chatId, childId).length, 2);
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
