import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decodeExternalSessionId,
  encodeExternalSessionId,
  listExternalSessionsFromContexts,
  readExternalTranscriptFromContexts
} from "./externalSessionsFromContexts";

interface SeedEntry {
  role: "user" | "assistant";
  content: unknown;
  timestamp: string;
}

function contextsDir(root: string, channelDir: string, botId: string, chatId: string): string {
  const dir = path.join(root, channelDir, "bots", botId, chatId, "contexts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedSession(dir: string, sessionId: string, entries: SeedEntry[], createdAt: string): void {
  const lines: string[] = [
    JSON.stringify({ type: "session", version: 1, id: sessionId, timestamp: createdAt })
  ];
  let prev: string | null = null;
  entries.forEach((entry, index) => {
    const id = `e${index}`;
    lines.push(
      JSON.stringify({
        type: "message",
        id,
        parentId: prev,
        timestamp: entry.timestamp,
        message: { role: entry.role, content: entry.content }
      })
    );
    prev = id;
  });
  writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8");
  writeFileSync(path.join(dir, `${sessionId}.json`), "[]\n", "utf8");
}

test("listExternalSessionsFromContexts projects contexts sessions, skips automation and empty", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-list-"));
  try {
    const dir = contextsDir(root, "moli-t", "mybot", "111");

    seedSession(
      dir,
      "default",
      [
        { role: "user", content: "First telegram question about the weather today", timestamp: "2026-07-01T00:00:00.000Z" },
        { role: "assistant", content: "Sunny", timestamp: "2026-07-01T00:00:05.000Z" }
      ],
      "2026-07-01T00:00:00.000Z"
    );
    seedSession(
      dir,
      "s-20260702-aaaa",
      [{ role: "user", content: "Second session", timestamp: "2026-07-02T00:00:00.000Z" }],
      "2026-07-02T00:00:00.000Z"
    );

    // Automation session is excluded via its origin metadata sidecar.
    seedSession(
      dir,
      "task-20260703-bbbb",
      [{ role: "user", content: "Scheduled run", timestamp: "2026-07-03T00:00:00.000Z" }],
      "2026-07-03T00:00:00.000Z"
    );
    writeFileSync(path.join(dir, "task-20260703-bbbb.meta.json"), JSON.stringify({ origin: "automation" }), "utf8");

    // Older automation contexts may be missing meta; task-* and [EVENT:...]
    // prompts still must not leak into the ordinary external session list.
    seedSession(
      dir,
      "task-20260703-cccc",
      [{ role: "user", content: "Scheduled run without metadata", timestamp: "2026-07-03T00:01:00.000Z" }],
      "2026-07-03T00:01:00.000Z"
    );
    seedSession(
      dir,
      "s-legacy-event",
      [{ role: "user", content: "[EVENT:event-1778258863702.json:periodic]\nDo the scheduled thing", timestamp: "2026-07-03T00:02:00.000Z" }],
      "2026-07-03T00:02:00.000Z"
    );

    // Header-only session with no messages is skipped.
    writeFileSync(
      path.join(dir, "empty.jsonl"),
      `${JSON.stringify({ type: "session", version: 1, id: "empty", timestamp: "2026-07-04T00:00:00.000Z" })}\n`,
      "utf8"
    );

    const sessions = listExternalSessionsFromContexts(root);
    const bySession = new Map(sessions.map((s) => [s.conversation.externalUserId, s]));

    assert.equal(sessions.length, 2);
    assert.ok(bySession.has("bot:mybot:chat:111:default"));
    assert.ok(bySession.has("bot:mybot:chat:111:s-20260702-aaaa"));
    assert.ok(!bySession.has("bot:mybot:chat:111:task-20260703-bbbb"));
    assert.ok(!bySession.has("bot:mybot:chat:111:task-20260703-cccc"));
    assert.ok(!bySession.has("bot:mybot:chat:111:s-legacy-event"));

    const dflt = bySession.get("bot:mybot:chat:111:default")!;
    assert.equal(dflt.channel, "telegram");
    assert.equal(dflt.conversation.title, "First telegram question about the weathe...");
    assert.equal(dflt.conversation.updatedAt, "2026-07-01T00:00:05.000Z");
    assert.deepEqual(decodeExternalSessionId(dflt.conversation.id), {
      channel: "telegram",
      botId: "mybot",
      chatId: "111",
      sessionId: "default"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readExternalTranscriptFromContexts projects messages and drops non-text blocks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-detail-"));
  try {
    const dir = contextsDir(root, "moli-f", "feishubot", "222");
    seedSession(
      dir,
      "default",
      [
        { role: "user", content: "Question", timestamp: "2026-07-01T00:00:00.000Z" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Here is the answer" },
            { type: "toolCall", name: "search", input: {} }
          ],
          timestamp: "2026-07-01T00:00:01.000Z"
        },
        // Tool-only assistant turn with no text is dropped entirely.
        { role: "assistant", content: [{ type: "toolCall", name: "x", input: {} }], timestamp: "2026-07-01T00:00:02.000Z" }
      ],
      "2026-07-01T00:00:00.000Z"
    );

    const id = encodeExternalSessionId({ channel: "feishu", botId: "feishubot", chatId: "222", sessionId: "default" });
    const result = readExternalTranscriptFromContexts(root, id);
    assert.ok(result);
    assert.equal(result!.conversation.channel, "feishu");
    assert.deepEqual(
      result!.messages.map((m) => ({ role: m.role, content: m.content })),
      [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Here is the answer" }
      ]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readExternalTranscriptFromContexts returns null for malformed, traversal, and missing ids", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-null-"));
  try {
    assert.equal(readExternalTranscriptFromContexts(root, "not-base64!!"), null);
    const traversal = encodeExternalSessionId({ channel: "telegram", botId: "..", chatId: "..", sessionId: "x" });
    assert.equal(readExternalTranscriptFromContexts(root, traversal), null);
    const missing = encodeExternalSessionId({ channel: "telegram", botId: "nope", chatId: "0", sessionId: "default" });
    assert.equal(readExternalTranscriptFromContexts(root, missing), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
