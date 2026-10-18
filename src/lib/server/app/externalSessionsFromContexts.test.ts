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

const sources = new Map<string, { channel: string; botId: string; chatId: string }>();
function contextsDir(root: string, channelDir: string, botId: string, chatId: string): string {
  const dir = path.join(root, "sessions", `${channelDir}_${botId}_${chatId}`.replace(/[^a-zA-Z0-9._-]/g, "_"), "contexts");
  sources.set(dir, { channel: ({ "moli-t": "telegram", "moli-f": "feishu", "moli-wx": "weixin" } as Record<string, string>)[channelDir], botId, chatId });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "default.meta.json"), JSON.stringify({ agentId: path.basename(path.dirname(dir)), source: sources.get(dir) }));
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
  writeFileSync(path.join(dir, `${sessionId}.meta.json`), JSON.stringify({ agentId: path.basename(path.dirname(dir)), source: sources.get(dir) }));
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

    // Older automation contexts may be missing meta; current t-*, legacy
    // task-*, and [EVENT:...] prompts still must not leak into the ordinary list.
    seedSession(
      dir,
      "task-20260703-cccc",
      [{ role: "user", content: "Scheduled run without metadata", timestamp: "2026-07-03T00:01:00.000Z" }],
      "2026-07-03T00:01:00.000Z"
    );
    seedSession(
      dir,
      "t-20260703-dddd",
      [{ role: "user", content: "Current task context", timestamp: "2026-07-03T00:01:30.000Z" }],
      "2026-07-03T00:01:30.000Z"
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
    assert.ok(!bySession.has("bot:mybot:chat:111:t-20260703-dddd"));
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

test("readExternalTranscriptFromContexts resolves ids with safe special characters (@, :, +, %)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-spec-"));
  try {
    const dir = contextsDir(root, "moli-wx", "weixin-momo-2", "o9cq803dQf4bT1KSlE1f0Bb8sxmc@im.wechat");
    seedSession(
      dir,
      "s-12345:67890",
      [{ role: "user", content: "Hello", timestamp: "2026-07-01T00:00:00.000Z" }],
      "2026-07-01T00:00:00.000Z"
    );

    const id = encodeExternalSessionId({
      channel: "weixin",
      botId: "weixin-momo-2",
      chatId: "o9cq803dQf4bT1KSlE1f0Bb8sxmc@im.wechat",
      sessionId: "s-12345:67890"
    });
    const result = readExternalTranscriptFromContexts(root, id);
    assert.ok(result);
    assert.equal(result!.conversation.channel, "weixin");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readExternalTranscriptFromContexts attaches generated image from imageGenerate toolResult to the following assistant message", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-image-"));
  try {
    const dir = contextsDir(root, "moli-f", "feishu-momo", "oc_chat1");
    const workspaceDir = path.dirname(dir);
    const imageAbsPath = path.join(workspaceDir, "scratch", "2026", "07", "10", "pastoral_evening.jpg");

    const lines: string[] = [
      JSON.stringify({ type: "session", version: 1, id: "default", timestamp: "2026-07-10T12:33:23.000Z" }),
      JSON.stringify({
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-07-10T12:33:23.017Z",
        message: { role: "user", content: [{ type: "text", text: "生成一张图" }] }
      }),
      JSON.stringify({
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-07-10T12:33:23.510Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_1", name: "imageGenerate", arguments: { prompt: "x" } }]
        }
      }),
      JSON.stringify({
        type: "message",
        id: "t1",
        parentId: "a1",
        timestamp: "2026-07-10T12:34:17.388Z",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "imageGenerate",
          content: [{ type: "text", text: "Successfully generated image" }],
          details: { path: "2026/07/10/pastoral_evening.jpg", filePath: imageAbsPath, uploaded: true },
          isError: false
        }
      }),
      JSON.stringify({
        type: "message",
        id: "a2",
        parentId: "t1",
        timestamp: "2026-07-10T12:34:17.390Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "已生成这幅田园晚景图" }]
        }
      })
    ];
    writeFileSync(path.join(dir, "default.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const id = encodeExternalSessionId({
      channel: "feishu",
      botId: "feishu-momo",
      chatId: "oc_chat1",
      sessionId: "default"
    });
    const result = readExternalTranscriptFromContexts(root, id);
    assert.ok(result);

    const assistant = result!.messages.find((m) => m.content.startsWith("已生成"));
    assert.ok(assistant, "assistant follow-up message should be present");
    const attachment = assistant!.attachments?.[0];
    assert.ok(attachment, "generated image should be attached to the assistant message");
    assert.equal(attachment!.mediaType, "image");
    assert.equal(attachment!.original, "pastoral_evening.jpg");
    assert.equal(attachment!.local, path.join("scratch", "2026", "07", "10", "pastoral_evening.jpg"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readExternalTranscriptFromContexts recovers user-sent attachments from the channel_attachments block and strips it from display", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-user-att-"));
  try {
    const dir = contextsDir(root, "moli-wx", "weixin-momo-2", "oc_chat1");
    const workspaceDir = path.dirname(dir);
    const attachmentAbsPath = path.join(workspaceDir, "attachments", "1774279785778_weixin_photo.jpeg");

    const userContent = [
      `[2026-03-23T15:29:45.000Z] [oc_chat1]: 看看这张图`,
      ``,
      `<channel_attachments>`,
      attachmentAbsPath,
      `</channel_attachments>`
    ].join("\n");

    const lines: string[] = [
      JSON.stringify({ type: "session", version: 1, id: "default", timestamp: "2026-03-23T15:29:45.000Z" }),
      JSON.stringify({
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-03-23T15:29:45.000Z",
        message: { role: "user", content: [{ type: "text", text: userContent }] }
      }),
      JSON.stringify({
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-03-23T15:29:50.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "收到" }] }
      })
    ];
    writeFileSync(path.join(dir, "default.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const id = encodeExternalSessionId({
      channel: "weixin",
      botId: "weixin-momo-2",
      chatId: "oc_chat1",
      sessionId: "default"
    });
    const result = readExternalTranscriptFromContexts(root, id);
    assert.ok(result);

    const user = result!.messages.find((m) => m.role === "user");
    assert.ok(user, "user message should be present");
    assert.equal(user!.content.includes("<channel_attachments>"), false, "attachment block must be stripped from display");
    assert.equal(user!.content.includes("看看这张图"), true, "user text must be preserved");
    const attachment = user!.attachments?.[0];
    assert.ok(attachment, "user attachment should be recovered from the block");
    assert.equal(attachment!.mediaType, "image");
    assert.equal(attachment!.mimeType, "image/jpeg");
    assert.equal(attachment!.original, "1774279785778_weixin_photo.jpeg");
    assert.equal(attachment!.local, path.join("attachments", "1774279785778_weixin_photo.jpeg"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const toolName of ["ttsGenerate", "imageGenerate", "videoGenerate"]) {
  test(`external transcript projects canonical ${toolName} media receipts after append`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-media-"));
    try {
      const dir = contextsDir(root, "moli-f", "bot", "chat");
      seedSession(dir, "default", [{ role: "user", content: "Generate media", timestamp: "2026-10-17T01:00:00.000Z" }], "2026-10-17T01:00:00.000Z");
      const id = encodeExternalSessionId({ channel: "feishu", botId: "bot", chatId: "chat", sessionId: "default" });
      assert.equal(readExternalTranscriptFromContexts(root, id)?.messages.length, 1);
      const mediaType = toolName === "ttsGenerate" ? "audio" : toolName === "imageGenerate" ? "image" : "video";
      const ext = { audio: "ogg", image: "png", video: "mp4" }[mediaType];
      const local = path.join("scratch", `generated.${ext}`);
      const entries = [
        { type: "message", id: "tool", parentId: "e0", timestamp: "2026-10-18T01:00:01.000Z", message: {
          role: "toolResult", toolName, toolCallId: "call", content: [],
          details: { molibotExecution: { version: 1, details: { filePath: path.join(path.dirname(dir), local), mimeType: `${mediaType}/${ext}`, uploaded: true } } }
        } },
        { type: "message", id: "answer", parentId: "tool", timestamp: "2026-10-18T01:00:02.000Z", message: { role: "assistant", content: "Media ready" } }
      ];
      const file = path.join(dir, "default.jsonl");
      writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "a" });
      const result = readExternalTranscriptFromContexts(root, id);
      assert.equal(result?.conversation.updatedAt, "2026-10-18T01:00:02.000Z");
      assert.deepEqual(result?.messages.at(-1)?.attachments, [{ original: `generated.${ext}`, local, mediaType }]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("canonical TTS receipts cannot expose files outside the session workspace", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-media-guard-"));
  try {
    const dir = contextsDir(root, "moli-f", "bot", "chat");
    seedSession(dir, "default", [{ role: "user", content: "Speak", timestamp: "2026-10-18T01:00:00.000Z" }], "2026-10-18T01:00:00.000Z");
    const rows = [
      { type: "message", id: "tool", parentId: "e0", timestamp: "2026-10-18T01:00:01.000Z", message: { role: "toolResult", toolName: "ttsGenerate", toolCallId: "call", content: [], details: { molibotExecution: { version: 1, details: { filePath: path.join(root, "private.ogg") } } } } },
      { type: "message", id: "answer", parentId: "tool", timestamp: "2026-10-18T01:00:02.000Z", message: { role: "assistant", content: "Done" } }
    ];
    writeFileSync(path.join(dir, "default.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n", { flag: "a" });
    const id = encodeExternalSessionId({ channel: "feishu", botId: "bot", chatId: "chat", sessionId: "default" });
    const result = readExternalTranscriptFromContexts(root, id);
    assert.equal(result?.messages.at(-1)?.content, "Done");
    assert.equal(result?.messages.at(-1)?.attachments, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("external transcript retains empty failed requests as display status, including failure followed by success", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-status-"));
  try {
    const dir = contextsDir(root, "moli-f", "bot", "chat");
    seedSession(dir, "default", [{ role: "user", content: "Hello", timestamp: "2026-10-18T01:00:00.000Z" }], "2026-10-18T01:00:00.000Z");
    const id = encodeExternalSessionId({ channel: "feishu", botId: "bot", chatId: "chat", sessionId: "default" });
    const rows = [{ type: "message", id: "error", parentId: "e0", timestamp: "2026-10-18T01:00:01.000Z", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "401: API key expired" } }];
    writeFileSync(path.join(dir, "default.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n", { flag: "a" });
    let result = readExternalTranscriptFromContexts(root, id);
    assert.equal(result?.messages.length, 2);
    assert.equal(result?.messages[1].content, "");
    assert.equal(result?.messages[1].stopReason, "error");
    assert.equal(result?.messages[1].errorMessage, "401: API key expired");
    writeFileSync(path.join(dir, "default.jsonl"), JSON.stringify({ type: "message", id: "answer", parentId: "error", timestamp: "2026-10-18T01:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Recovered answer" }], stopReason: "stop" } }) + "\n", { flag: "a" });
    result = readExternalTranscriptFromContexts(root, id);
    assert.equal(result?.messages.at(-1)?.stopReason, "stop");
    assert.equal(result?.messages.at(-1)?.content, "Recovered answer");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const outcome of ["stop", "error"]) {
  test(`external status uses the final ${outcome} run outcome even when the reply projection is missing`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "molibot-ctx-run-status-"));
    try {
      const dir = contextsDir(root, "moli-f", "bot", "chat");
      seedSession(dir, "default", [], "2026-10-18T01:00:00.000Z");
      writeFileSync(path.join(dir, "default.jsonl"), JSON.stringify({ type: "message", id: "u", runId: "run-1", parentId: null, timestamp: "2026-10-18T01:00:00.000Z", message: { role: "user", content: "Hello" } }) + "\n", { flag: "a" });
      writeFileSync(path.join(path.dirname(dir), "run-summaries.jsonl"), JSON.stringify({ runId: "run-1", sessionId: "default", source: { channel: "feishu", botId: "bot", chatId: "chat" }, stopReason: outcome, errorMessage: outcome === "error" ? "Finalization failed" : undefined, finalText: "Do not invent this missing reply", createdAt: "2026-10-18T01:00:01.000Z" }) + "\n");
      const id = encodeExternalSessionId({ channel: "feishu", botId: "bot", chatId: "chat", sessionId: "default" });
      const result = readExternalTranscriptFromContexts(root, id);
      assert.equal(result?.messages.at(-1)?.role, "assistant");
      assert.equal(result?.messages.at(-1)?.stopReason, outcome);
      assert.equal(result?.messages.at(-1)?.content, "");
      assert.doesNotMatch(JSON.stringify(result?.messages), /Do not invent this missing reply/);
      if (outcome === "error") assert.equal(result?.messages.at(-1)?.errorMessage, "Finalization failed");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
