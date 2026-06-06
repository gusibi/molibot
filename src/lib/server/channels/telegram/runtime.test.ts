import assert from "node:assert/strict";
import test from "node:test";
import { TELEGRAM_SHARED_COMMANDS } from "$lib/server/channels/telegram/commands.js";
import { TelegramManager } from "$lib/server/channels/telegram/runtime.js";

// Mock dependencies for TelegramManager instantiation
const mockGetSettings = () => ({}) as any;
const mockUpdateSettings = (patch: any) => ({}) as any;
const mockSessions = {} as any;
const mockDeps = {
  instanceId: "test-bot",
  workspaceDir: "/tmp/test-bot",
  memory: {} as any,
  usageTracker: {} as any,
  modelErrorTracker: {} as any
};

class TestTelegramManager extends TelegramManager {
  constructor() {
    super(mockGetSettings, mockUpdateSettings, mockSessions, mockDeps);
  }
  public testDetectAudioMime(filename: string, data: Buffer) {
    return (this as any).detectAudioMime(filename, data);
  }
  public testDetectVideoMime(filename: string, data: Buffer) {
    return (this as any).detectVideoMime(filename, data);
  }
}

test("telegram registers shared live-control, queue, and host-tool commands", () => {
  const registered = new Set<string>(TELEGRAM_SHARED_COMMANDS);
  for (const command of ["steer", "followup", "follow_up", "queue", "hosttools", "host-tools"]) {
    assert.ok(
      registered.has(command),
      `expected /${command} to be handled before busy-message enqueue`
    );
  }
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

