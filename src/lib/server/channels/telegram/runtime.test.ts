import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TELEGRAM_SHARED_COMMANDS } from "$lib/server/channels/telegram/commands.js";
import { TelegramManager } from "$lib/server/channels/telegram/runtime.js";
import { buildTelegramMemoryReviewKeyboard, parseTelegramMemoryReviewCallback } from "$lib/server/channels/telegram/memoryReview.js";
import { buildTelegramQueuedControlKeyboard, parseTelegramQueuedControlCallback } from "$lib/server/channels/telegram/queuedControl.js";

// Mock dependencies for TelegramManager instantiation
const mockGetSettings = () => ({}) as any;
const mockUpdateSettings = (patch: any) => ({}) as any;
const mockSessions = {} as any;
function createMockDeps() {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-telegram-runtime-test-"));
  return {
    instanceId: "test-bot",
    workspaceDir,
    queueDbFile: join(workspaceDir, "inbound-queue.sqlite"),
    memory: {} as any,
    memoryReview: { decide: async () => ({ status: "stale" }) } as any,
    usageTracker: {} as any,
    modelErrorTracker: {} as any,
    hookManager: {
      register: () => {},
      unregister: () => false,
      list: () => [],
      registerPlugin: async () => {},
      unregisterPlugin: async () => false,
      emit: () => {},
      flush: async () => {},
      transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
      gate: async () => ({ type: "allow" })
    } as any
  };
}

class TestTelegramManager extends TelegramManager {
  constructor() {
    super(mockGetSettings, mockUpdateSettings, mockSessions, createMockDeps());
  }
  public testDetectAudioMime(filename: string, data: Buffer) {
    return (this as any).detectAudioMime(filename, data);
  }
  public testDetectVideoMime(filename: string, data: Buffer) {
    return (this as any).detectVideoMime(filename, data);
  }
  public testResolveAttachmentUploadName(filePath: string, title?: string) {
    return (this as any).resolveAttachmentUploadName(filePath, title);
  }
  public setTestBot(bot: unknown) {
    (this as any).bot = bot;
  }
}

test("telegram registers shared live-control, queue, and host-tool commands", () => {
  const registered = new Set<string>(TELEGRAM_SHARED_COMMANDS);
  assert.equal(registered.has("login"), false);
  assert.equal(registered.has("logout"), false);
  for (const command of ["steer", "followup", "follow_up", "queue", "hosttools", "host-tools"]) {
    assert.ok(
      registered.has(command),
      `expected /${command} to be handled before busy-message enqueue`
    );
  }
});

test("telegram memory review callbacks stay compact and parse only known actions", () => {
  const candidateId = "123e4567-e89b-12d3-a456-426614174000";
  assert.deepEqual(parseTelegramMemoryReviewCallback(`mrv:k:${candidateId}`), { action: "keep", candidateId });
  assert.deepEqual(parseTelegramMemoryReviewCallback(`mrv:i:${candidateId}`), { action: "ignore", candidateId });
  assert.equal(parseTelegramMemoryReviewCallback(`mrv:x:${candidateId}`), null);
  assert.equal(parseTelegramMemoryReviewCallback("mrv:k:not-a-uuid"), null);
  const keyboard = buildTelegramMemoryReviewKeyboard(candidateId);
  const callbacks = keyboard.inline_keyboard.flatMap((row) => row.map((button) => "callback_data" in button ? button.callback_data : ""));
  assert.deepEqual(callbacks, [`mrv:k:${candidateId}`, `mrv:i:${candidateId}`]);
  assert.equal(callbacks.every((value) => Buffer.byteLength(value, "utf8") <= 64), true);
});

test("telegram queued-control callbacks stay compact and bind both actions to one queue item", () => {
  assert.deepEqual(parseTelegramQueuedControlCallback("qctl:x:12"), { action: "stop", queueId: 12 });
  assert.deepEqual(parseTelegramQueuedControlCallback("qctl:s:12"), { action: "steer", queueId: 12 });
  assert.equal(parseTelegramQueuedControlCallback("qctl:s:0"), null);
  assert.equal(parseTelegramQueuedControlCallback("qctl:z:12"), null);
  const keyboard = buildTelegramQueuedControlKeyboard(12);
  const callbacks = keyboard.inline_keyboard.flatMap((row) => row.map((button) => "callback_data" in button ? button.callback_data : ""));
  assert.deepEqual(callbacks, ["qctl:x:12", "qctl:s:12"]);
  assert.equal(callbacks.every((value) => Buffer.byteLength(value, "utf8") <= 64), true);
});

test("telegram MIME detection for audio and video files", () => {
  const manager = new TestTelegramManager();

  // 1. MP4 Video file detection
  const mp4Header = Buffer.alloc(12);
  mp4Header.write("ftyp", 4); // signature at byte 4-7
  
  assert.equal(manager.testDetectVideoMime("video.mp4", mp4Header), "video/mp4");
  assert.equal(manager.testDetectAudioMime("video.mp4", mp4Header), undefined);

  // 2. M4A Audio file detection
  assert.equal(manager.testDetectVideoMime("audio.m4a", mp4Header), undefined);
  assert.equal(manager.testDetectAudioMime("audio.m4a", mp4Header), "audio/mp4");

  // 3. WebM and MOV Video file detection
  const emptyBuffer = Buffer.alloc(0);
  assert.equal(manager.testDetectVideoMime("movie.webm", emptyBuffer), "video/webm");
  assert.equal(manager.testDetectAudioMime("movie.webm", emptyBuffer), undefined);
  assert.equal(manager.testDetectVideoMime("clip.mov", emptyBuffer), "video/quicktime");
  assert.equal(manager.testDetectAudioMime("clip.mov", emptyBuffer), undefined);

  // 4. OGG and MP3 Audio file detection
  const oggHeader = Buffer.from("OggS");
  assert.equal(manager.testDetectAudioMime("voice.ogg", oggHeader), "audio/ogg");
  assert.equal(manager.testDetectVideoMime("voice.ogg", oggHeader), undefined);
});

test("telegram media upload name preserves source extension when title omits it", () => {
  const manager = new TestTelegramManager();

  assert.equal(
    manager.testResolveAttachmentUploadName("/workspace/scratch/2026/06/06/aerobics_practice.mp4", "女健美操运动员练习视频"),
    "女健美操运动员练习视频.mp4"
  );
  assert.equal(
    manager.testResolveAttachmentUploadName("/workspace/scratch/2026/06/06/aerobics_practice.mp4", "custom-name.mp4"),
    "custom-name.mp4"
  );
});

test("telegram sends memory review buttons only to private chats", async () => {
  const manager = new TestTelegramManager();
  const sends: unknown[] = [];
  let chatType: "private" | "group" = "private";
  manager.setTestBot({
    api: {
      getChat: async () => ({ type: chatType }),
      sendMessage: async (chatId: string, text: string, options: unknown) => {
        sends.push({ chatId, text, options });
        return { message_id: 42 };
      }
    }
  });
  const item = { batchId: "batch", candidateId: "123e4567-e89b-12d3-a456-426614174000", ordinal: 1, value: "主人希望回答简短直接" };
  assert.deepEqual(await manager.sendMemoryReviewItem("chat-1", item), { messageId: "42" });
  assert.equal(sends.length, 1);
  chatType = "group";
  assert.equal(await manager.sendMemoryReviewItem("chat-2", item), null);
  assert.equal(sends.length, 1);
});
