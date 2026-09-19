import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { readSessionDisplayMetadata } from "$lib/server/agent/session/metadata.js";
import {
  listExternalSessionMetaFromContexts,
  readExternalTranscriptFromContexts,
  rebuildExternalSessionMetadata
} from "$lib/server/app/externalSessionsFromContexts.js";
import { listManagedExternalCandidates } from "$lib/server/app/sessionMaintenance.js";

function message(role: "user" | "assistant", text: string, timestamp = Date.now()): AgentMessage {
  return { role, content: [{ type: "text", text }], timestamp } as AgentMessage;
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "molibot-session-meta-"));
}

function botWorkspace(root: string, channelDir: string, botId: string): string {
  return join(root, channelDir, "bots", botId);
}

function contextsDir(root: string, channelDir: string, botId: string, chatId: string): string {
  return join(botWorkspace(root, channelDir, botId), chatId, "contexts");
}

/** Seeds a raw legacy session with no metadata sidecar (pre-upgrade shape). */
function seedLegacySession(
  root: string,
  channelDir: string,
  botId: string,
  chatId: string,
  sessionId: string,
  entries: Array<{ role: "user" | "assistant"; content: unknown; timestamp: string }>,
  createdAt: string
): string {
  const dir = contextsDir(root, channelDir, botId, chatId);
  mkdirSync(dir, { recursive: true });
  const lines = [JSON.stringify({ type: "session", version: 1, id: sessionId, timestamp: createdAt })];
  let prev: string | null = null;
  entries.forEach((entry, index) => {
    const id = `e${index}`;
    lines.push(JSON.stringify({
      type: "message",
      id,
      parentId: prev,
      timestamp: entry.timestamp,
      message: { role: entry.role, content: entry.content }
    }));
    prev = id;
  });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(join(dir, `${sessionId}.json`), "[]\n", "utf8");
  return file;
}

test("MomRuntimeStore keeps display metadata in step with the log and preserves origin", () => {
  const root = makeRoot();
  try {
    const workspace = botWorkspace(root, "moli-t", "mybot");
    const store = new MomRuntimeStore(workspace);
    const chatId = "111";
    const sessionId = store.createSession(chatId);
    const dir = contextsDir(root, "moli-t", "mybot", chatId);

    assert.equal(readSessionDisplayMetadata(dir, sessionId), null, "no metadata before any message");

    store.appendContextMessage(chatId, message("user", "First real question", Date.parse("2026-07-01T00:00:00Z")), sessionId);
    let display = readSessionDisplayMetadata(dir, sessionId);
    assert.ok(display);
    assert.equal(display.hasMessages, true);
    assert.equal(display.title, "First real question");
    assert.equal(display.eventPrompt, false);

    store.markSessionOrigin(chatId, sessionId, { origin: "chat" });
    display = readSessionDisplayMetadata(dir, sessionId);
    assert.equal(display?.title, "First real question", "origin write must not drop display metadata");
    assert.equal(store.readSessionOrigin(chatId, sessionId)?.origin, "chat");

    store.appendContextMessage(chatId, message("assistant", "An answer", Date.parse("2026-07-01T00:00:05Z")), sessionId);
    const afterReply = readSessionDisplayMetadata(dir, sessionId);
    assert.equal(afterReply?.title, "First real question", "title stays on the first user message");
    assert.ok(afterReply && afterReply.updatedAt > display!.updatedAt, "updatedAt follows the newest message");

    store.clearSessionContext(chatId, sessionId);
    const cleared = readSessionDisplayMetadata(dir, sessionId);
    assert.equal(cleared?.hasMessages, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MomRuntimeStore flags internal Event Sessions without an Event classification hint", () => {
  const root = makeRoot();
  try {
    const workspace = botWorkspace(root, "moli-t", "mybot");
    const store = new MomRuntimeStore(workspace);
    const chatId = "111";
    const sessionId = store.createSession(chatId);
    store.appendContextMessage(chatId, message("user", "[EVENT:reminder] do the thing"), sessionId);
    const display = readSessionDisplayMetadata(contextsDir(root, "moli-t", "mybot", chatId), sessionId);
    assert.equal(display?.eventPrompt, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rebuildExternalSessionMetadata derives metadata once and stays idempotent", () => {
  const root = makeRoot();
  try {
    seedLegacySession(root, "moli-t", "mybot", "111", "s-legacy", [
      { role: "user", content: "Legacy telegram question", timestamp: "2026-07-01T00:00:00.000Z" },
      { role: "assistant", content: "Legacy answer", timestamp: "2026-07-01T00:00:05.000Z" }
    ], "2026-07-01T00:00:00.000Z");
    seedLegacySession(root, "moli-t", "mybot", "111", "s-empty", [], "2026-07-02T00:00:00.000Z");
    seedLegacySession(root, "moli-f", "fbot", "222", "s-event", [
      { role: "user", content: "[EVENT:reminder] run", timestamp: "2026-07-03T00:00:00.000Z" }
    ], "2026-07-03T00:00:00.000Z");
    // Automation classification comes from the sidecar, so seed it explicitly.
    mkdirSync(contextsDir(root, "moli-f", "fbot", "222"), { recursive: true });
    writeFileSync(
      join(contextsDir(root, "moli-f", "fbot", "222"), "s-auto.meta.json"),
      JSON.stringify({ origin: "automation" }),
      "utf8"
    );
    seedLegacySession(root, "moli-f", "fbot", "222", "s-auto", [
      { role: "user", content: "automation output", timestamp: "2026-07-04T00:00:00.000Z" }
    ], "2026-07-04T00:00:00.000Z");

    const first = rebuildExternalSessionMetadata(root);
    assert.equal(first.scanned, 4);
    assert.equal(first.rebuilt, 4, "every unindexed session is derived once");

    const second = rebuildExternalSessionMetadata(root);
    assert.equal(second.rebuilt, 0, "indexed sessions are not re-derived");

    const dir = contextsDir(root, "moli-t", "mybot", "111");
    assert.equal(readSessionDisplayMetadata(dir, "s-legacy")?.title, "Legacy telegram question");
    assert.equal(readSessionDisplayMetadata(dir, "s-empty")?.hasMessages, false);
    assert.equal(readSessionDisplayMetadata(contextsDir(root, "moli-f", "fbot", "222"), "s-event")?.eventPrompt, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listExternalSessionMetaFromContexts reads metadata only and never parses transcripts", () => {
  const root = makeRoot();
  try {
    const legacyFile = seedLegacySession(root, "moli-t", "mybot", "111", "s-legacy", [
      { role: "user", content: "Metadata only please", timestamp: "2026-07-01T00:00:00.000Z" }
    ], "2026-07-01T00:00:00.000Z");
    seedLegacySession(root, "moli-t", "mybot", "111", "s-empty", [], "2026-07-02T00:00:00.000Z");
    rebuildExternalSessionMetadata(root);

    // Deterministic failure probe on the Agent Context body boundary: a
    // truncated/corrupt transcript must not change the metadata list at all.
    writeFileSync(legacyFile, "not-json-at-all\n", "utf8");

    const entries = listExternalSessionMetaFromContexts(root);
    assert.equal(entries.length, 1, "empty sessions are skipped without parsing");
    const entry = entries[0];
    assert.equal(entry.channel, "telegram");
    assert.equal(entry.conversation.title, "Metadata only please");
    assert.equal(entry.conversation.updatedAt, "2026-07-01T00:00:00.000Z");
    assert.equal(entry.preview, undefined, "ordinary lists omit the preview field");

    const managed = listManagedExternalCandidates(root);
    assert.equal(managed.length, 1, "session management reuses the metadata projection");
    assert.equal(managed[0].channel, "telegram");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a listed external session still opens its full transcript", () => {
  const root = makeRoot();
  try {
    seedLegacySession(root, "moli-t", "mybot", "111", "s-chat", [
      { role: "user", content: "open me later", timestamp: "2026-07-01T00:00:00.000Z" },
      { role: "assistant", content: "opened", timestamp: "2026-07-01T00:00:05.000Z" }
    ], "2026-07-01T00:00:00.000Z");
    rebuildExternalSessionMetadata(root);

    const listed = listExternalSessionMetaFromContexts(root);
    assert.equal(listed.length, 1);
    const transcript = readExternalTranscriptFromContexts(root, listed[0].conversation.id);
    assert.ok(transcript);
    assert.deepEqual(
      transcript.messages.map((message) => message.content),
      ["open me later", "opened"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listExternalSessionMetaFromContexts skips automation, Event and empty sessions", () => {
  const root = makeRoot();
  try {
    seedLegacySession(root, "moli-t", "mybot", "111", "s-chat", [
      { role: "user", content: "ordinary", timestamp: "2026-07-01T00:00:00.000Z" }
    ], "2026-07-01T00:00:00.000Z");
    seedLegacySession(root, "moli-t", "mybot", "111", "s-event", [
      { role: "user", content: "[EVENT:x] run", timestamp: "2026-07-02T00:00:00.000Z" }
    ], "2026-07-02T00:00:00.000Z");
    mkdirSync(contextsDir(root, "moli-t", "mybot", "111"), { recursive: true });
    writeFileSync(
      join(contextsDir(root, "moli-t", "mybot", "111"), "s-auto.meta.json"),
      JSON.stringify({ origin: "automation" }),
      "utf8"
    );
    seedLegacySession(root, "moli-t", "mybot", "111", "s-auto", [
      { role: "user", content: "auto", timestamp: "2026-07-03T00:00:00.000Z" }
    ], "2026-07-03T00:00:00.000Z");
    rebuildExternalSessionMetadata(root);

    const ids = listExternalSessionMetaFromContexts(root).map((entry) => entry.conversation.id);
    assert.equal(ids.length, 1);
    const only = listExternalSessionMetaFromContexts(root)[0];
    assert.equal(only.conversation.title, "ordinary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
