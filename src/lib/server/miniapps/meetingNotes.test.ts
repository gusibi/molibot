import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import createMeetingNotes from "./builtin/meeting-notes/server/index.mjs";

function request(path: string, options: { method?: string; body?: unknown; query?: Record<string, string[]>; contentType?: string } = {}) {
  return {
    method: options.method ?? "GET",
    path,
    query: options.query ?? {},
    body: options.body,
    contentType: options.contentType,
    signal: new AbortController().signal
  };
}

async function waitFor<T>(read: () => Promise<T> | T, accept: (value: T) => boolean, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for state: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = await read();
  }
  return value;
}

function contextOver(
  dataDir: string,
  overrides: {
    transcribe?: (input: { path: string }) => Promise<{ text: string; durationSeconds: number }>;
    generateText?: (input: { prompt: string }) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }>;
  } = {}
) {
  return {
    appId: "meeting-notes",
    dataDir,
    logger: { info() {}, warn() {}, error() {} },
    ai: {
      transcribe: overrides.transcribe ?? (async ({ path }) => ({ text: `Transcript ${basename(path)}`, durationSeconds: 5 })),
      generateText: overrides.generateText ?? (async () => ({
        text: "# Summary\n\nGenerated",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
      }))
    }
  };
}

async function createMeeting(runtime: ReturnType<typeof createMeetingNotes>, title = "Design review") {
  const created = await runtime.handleHttp(request("/meetings", { method: "POST", body: { title, language: "zh-CN" } }));
  assert.equal(created.status, 201);
  assert.equal(created.body.meeting.title, title);
  assert.equal(created.body.track.sourceKind, "microphone");
  return created.body as { meeting: { id: string }; track: { id: string } };
}

async function addChunk(
  runtime: ReturnType<typeof createMeetingNotes>,
  meetingId: string,
  trackId: string,
  seq: number,
  startMs: number,
  endMs: number,
  bytes = new Uint8Array([seq + 1, 2, 3])
) {
  return runtime.handleHttp(request(`/chunks/${meetingId}`, {
    method: "POST",
    query: {
      trackId: [trackId],
      seq: [String(seq)],
      startMs: [String(startMs)],
      endMs: [String(endMs)]
    },
    body: bytes,
    contentType: "audio/webm"
  }));
}

test("multi-track chunks are idempotent and finalization reports an explicit missing sequence", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-v2-"));
  const transcriptionCalls = new Map<string, number>();
  const summaryPrompts: string[] = [];
  const runtime = createMeetingNotes(contextOver(dataDir, {
    transcribe: async ({ path }) => {
      transcriptionCalls.set(path, (transcriptionCalls.get(path) ?? 0) + 1);
      return { text: `Text for ${readFileSync(join(dataDir, path))[0]}`, durationSeconds: 5 };
    },
    generateText: async ({ prompt }) => {
      summaryPrompts.push(prompt);
      return { text: "# Summary\n\nPartial but explicit", usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 } };
    }
  }));
  const { meeting, track } = await createMeeting(runtime);

  const first = await addChunk(runtime, meeting.id, track.id, 0, 0, 5_000);
  const duplicate = await addChunk(runtime, meeting.id, track.id, 0, 0, 5_000);
  assert.equal(first.status, 202);
  assert.equal(duplicate.body.chunk.id, first.body.chunk.id);
  await addChunk(runtime, meeting.id, track.id, 2, 10_000, 15_000);

  const finishing = await runtime.handleHttp(request(`/meetings/${meeting.id}/finish`, {
    method: "POST",
    body: { tracks: [{ id: track.id, expectedLastSeq: 2, endMs: 15_000 }] }
  }));
  assert.ok(["finalizing", "summarizing", "partial"].includes(finishing.body.meeting.status));

  const detail = await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting,
    (value) => value.status === "partial"
  );
  assert.deepEqual(detail.completeness.missingChunks, [{ trackId: track.id, seq: 1 }]);
  assert.equal(detail.completeness.failedChunks.length, 0);
  assert.equal(detail.tracks[0].expectedLastSeq, 2);
  assert.deepEqual(detail.chunks.map((chunk: { seq: number }) => chunk.seq), [0, 2]);
  assert.equal(detail.utterances.length, 2);
  assert.ok(summaryPrompts.length >= 1);
  assert.ok(summaryPrompts.every((prompt) => Buffer.byteLength(prompt, "utf8") < 64 * 1024));
  assert.equal([...transcriptionCalls.values()].reduce((sum, count) => sum + count, 0), 2);
  runtime.dispose();
});

test("finish is a barrier and never summarizes while a received chunk is still transcribing", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-barrier-"));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let transcriptionStarted = false;
  let summaryCalls = 0;
  const runtime = createMeetingNotes(contextOver(dataDir, {
    transcribe: async () => {
      transcriptionStarted = true;
      await blocked;
      return { text: "The delayed transcript", durationSeconds: 5 };
    },
    generateText: async () => {
      summaryCalls += 1;
      return { text: "# Summary\n\nComplete", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    }
  }));
  const { meeting, track } = await createMeeting(runtime);
  await addChunk(runtime, meeting.id, track.id, 0, 0, 5_000);
  await waitFor(() => transcriptionStarted, Boolean);

  await runtime.handleHttp(request(`/meetings/${meeting.id}/finish`, {
    method: "POST",
    body: { tracks: [{ id: track.id, expectedLastSeq: 0, endMs: 5_000 }] }
  }));
  const before = (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting;
  assert.equal(before.status, "finalizing");
  assert.equal(summaryCalls, 0);

  release();
  const completed = await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting,
    (value) => value.status === "ready"
  );
  assert.equal(completed.completeness.missingChunks.length, 0);
  assert.equal(completed.captureWarning, "");
  assert.ok(completed.endedAt);
  assert.equal(summaryCalls, 1);
  runtime.dispose();
});

test("a recording produces bounded provisional notes before it is stopped", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-live-notes-"));
  const prompts: string[] = [];
  const runtime = createMeetingNotes(contextOver(dataDir, {
    transcribe: async ({ path }) => ({ text: `Spoken ${basename(path)}`, durationSeconds: 10 }),
    generateText: async ({ prompt }) => {
      prompts.push(prompt);
      return { text: "## Decisions\n\n- Provisional", usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } };
    }
  }));
  const { meeting, track } = await createMeeting(runtime);
  for (let seq = 0; seq < 6; seq += 1) {
    await addChunk(runtime, meeting.id, track.id, seq, seq * 10_000, (seq + 1) * 10_000);
  }
  const live = await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting,
    (value) => Boolean(value.liveNotes)
  );
  assert.equal(live.status, "recording");
  assert.equal(live.liveNotesThroughMs, 60_000);
  assert.ok(prompts.length >= 1);
  assert.ok(prompts.every((prompt) => prompt.length < 12_000));
  runtime.dispose();
});

test("restart requeues an orphaned transcription instead of terminalizing the whole processing pipeline", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-restart-v2-"));
  const first = createMeetingNotes(contextOver(dataDir));
  const { meeting, track } = await createMeeting(first);
  const added = await addChunk(first, meeting.id, track.id, 0, 0, 5_000);
  await waitFor(
    async () => (await first.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting.chunks[0],
    (chunk) => chunk.status === "complete"
  );
  first.dispose();

  const db = new DatabaseSync(join(dataDir, "meetings.sqlite"));
  db.prepare("UPDATE audio_chunks SET status='transcribing' WHERE id=?").run(added.body.chunk.id);
  db.prepare("UPDATE meetings SET status='finalizing' WHERE id=?").run(meeting.id);
  db.close();

  let resumedCalls = 0;
  const restarted = createMeetingNotes(contextOver(dataDir, {
    transcribe: async () => {
      resumedCalls += 1;
      return { text: "Recovered transcript", durationSeconds: 5 };
    }
  }));
  await restarted.handleHttp(request(`/meetings/${meeting.id}/finish`, {
    method: "POST",
    body: { tracks: [{ id: track.id, expectedLastSeq: 0, endMs: 5_000 }] }
  }));
  const recovered = await waitFor(
    async () => (await restarted.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting,
    (value) => value.status === "ready"
  );
  assert.equal(resumedCalls, 1);
  assert.equal(recovered.chunks[0].status, "complete");
  restarted.dispose();
});

test("a v1 draft database is backed up and never read through a compatibility layer", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-old-schema-"));
  const old = new DatabaseSync(join(dataDir, "meetings.sqlite"));
  old.exec("CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT); INSERT INTO meetings VALUES ('old', 'Old draft');");
  old.close();
  mkdirSync(join(dataDir, "audio", "old"), { recursive: true });
  writeFileSync(join(dataDir, "audio", "old", "draft.webm"), new Uint8Array([1, 2, 3]));

  const runtime = createMeetingNotes(contextOver(dataDir));
  const listed = runtime.handleHttp(request("/meetings"));
  assert.ok(listed instanceof Promise);
  const names = readdirSync(dataDir);
  assert.ok(names.some((name) => name.startsWith("meetings.sqlite.backup-")));
  assert.ok(names.some((name) => name.startsWith("audio.backup-")));
  const current = new DatabaseSync(join(dataDir, "meetings.sqlite"));
  assert.equal(current.prepare("PRAGMA user_version").get().user_version, 2);
  assert.equal(current.prepare("SELECT COUNT(*) AS count FROM meetings").get().count, 0);
  current.close();
  runtime.dispose();
});

test("deleting a meeting removes every retained track chunk", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-delete-v2-"));
  const runtime = createMeetingNotes(contextOver(dataDir));
  const { meeting, track } = await createMeeting(runtime);
  const added = await addChunk(runtime, meeting.id, track.id, 0, 0, 5_000);
  await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting.chunks[0],
    (chunk) => chunk.status === "complete"
  );
  const retainedPath = join(dataDir, added.body.chunk.audioPath);
  assert.equal(existsSync(retainedPath), true);
  await runtime.handleHttp(request(`/meetings/${meeting.id}/finish`, {
    method: "POST",
    body: { tracks: [{ id: track.id, expectedLastSeq: 0, endMs: 5_000 }] }
  }));
  await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting.status,
    (status) => status === "ready"
  );
  await runtime.tools.delete({ id: meeting.id });
  assert.equal(existsSync(retainedPath), false);
  runtime.dispose();
});

test("an active capture cannot be deleted or forced into summary generation", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-active-guard-"));
  const runtime = createMeetingNotes(contextOver(dataDir));
  const { meeting } = await createMeeting(runtime);
  const regenerate = await runtime.handleHttp(request(`/meetings/${meeting.id}/regenerate`, { method: "POST", body: {} }));
  const remove = await runtime.handleHttp(request(`/meetings/${meeting.id}`, { method: "DELETE" }));
  assert.equal(regenerate.status, 409);
  assert.equal(remove.status, 409);
  const detail = await runtime.handleHttp(request(`/meetings/${meeting.id}`));
  assert.equal(detail.body.meeting.status, "recording");
  runtime.dispose();
});

test("pause and resume are idempotent meeting state transitions", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-pause-"));
  const runtime = createMeetingNotes(contextOver(dataDir));
  const { meeting } = await createMeeting(runtime);

  const paused = await runtime.handleHttp(request(`/meetings/${meeting.id}/pause`, { method: "POST", body: {} }));
  assert.equal(paused.status ?? 200, 200);
  assert.equal(paused.body.meeting.status, "paused");

  const pausedAgain = await runtime.handleHttp(request(`/meetings/${meeting.id}/pause`, { method: "POST", body: {} }));
  assert.equal(pausedAgain.status ?? 200, 200);
  assert.equal(pausedAgain.body.meeting.status, "paused");

  const resumed = await runtime.handleHttp(request(`/meetings/${meeting.id}/resume`, { method: "POST", body: {} }));
  assert.equal(resumed.status ?? 200, 200);
  assert.equal(resumed.body.meeting.status, "recording");
  runtime.dispose();
});

test("a paused meeting is protected as active and becomes interrupted after service restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-paused-restart-"));
  const first = createMeetingNotes(contextOver(dataDir));
  const { meeting } = await createMeeting(first);
  const paused = await first.handleHttp(request(`/meetings/${meeting.id}/pause`, { method: "POST", body: {} }));
  assert.equal(paused.status ?? 200, 200);
  assert.equal(paused.body.meeting.status, "paused");

  const regenerate = await first.handleHttp(request(`/meetings/${meeting.id}/regenerate`, { method: "POST", body: {} }));
  const remove = await first.handleHttp(request(`/meetings/${meeting.id}`, { method: "DELETE" }));
  assert.equal(regenerate.status, 409);
  assert.equal(remove.status, 409);
  first.dispose();

  const restarted = createMeetingNotes(contextOver(dataDir));
  const detail = await restarted.handleHttp(request(`/meetings/${meeting.id}`));
  assert.equal(detail.body.meeting.status, "interrupted");

  const reconciled = await restarted.handleHttp(request(`/meetings/${meeting.id}/pause`, { method: "POST", body: {} }));
  assert.equal(reconciled.body.meeting.status, "paused");
  restarted.dispose();
});

test("history search covers titles, notes, and transcript text and returns active duration", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-history-search-"));
  const runtime = createMeetingNotes(contextOver(dataDir, {
    transcribe: async () => ({ text: "Project Atlas launch", durationSeconds: 5 })
  }));
  const { meeting, track } = await createMeeting(runtime, "Weekly planning");
  await addChunk(runtime, meeting.id, track.id, 0, 0, 5_000);
  await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting.utterances.length,
    (count) => count === 1
  );

  const byTranscript = await runtime.handleHttp(request("/meetings", { query: { q: ["atlas"] } }));
  assert.equal(byTranscript.body.meetings.length, 1);
  assert.equal(byTranscript.body.meetings[0].id, meeting.id);
  assert.equal(byTranscript.body.meetings[0].durationMs, 0);

  await runtime.handleHttp(request(`/meetings/${meeting.id}/finish`, {
    method: "POST",
    body: { tracks: [{ id: track.id, expectedLastSeq: 0, endMs: 5_000 }] }
  }));
  const completed = await waitFor(
    async () => (await runtime.handleHttp(request("/meetings", { query: { q: ["weekly"] } }))).body.meetings[0],
    (item) => item?.status === "ready"
  );
  assert.equal(completed.durationMs, 5_000);
  runtime.dispose();
});

test("meeting audio streaming and batch retry transcription routes work correctly", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-audio-"));
  let failTranscription = true;
  const runtime = createMeetingNotes(contextOver(dataDir, {
    transcribe: async () => {
      if (failTranscription) {
        throw Object.assign(new Error("No STT capability"), { code: "capability_unavailable" });
      }
      return { text: "Meeting transcript text", durationSeconds: 5 };
    }
  }));

  const { meeting, track } = await createMeeting(runtime, "Audio Test Meeting");
  // 创建一个合成的 44-byte WAV header + PCM
  const wavHeader = Buffer.alloc(44);
  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(44 - 8 + 4, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // PCM
  wavHeader.writeUInt16LE(1, 22); // Mono
  wavHeader.writeUInt32LE(16000, 24); // 16kHz
  wavHeader.writeUInt32LE(32000, 28); // byte rate
  wavHeader.writeUInt16LE(2, 32); // block align
  wavHeader.writeUInt16LE(16, 34); // bits per sample
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(4, 40); // 4 bytes PCM
  const pcmData = Buffer.from([0x00, 0x10, 0x00, 0x20]);
  const wavBytes = Buffer.concat([wavHeader, pcmData]);

  const chunkRes = await addChunk(runtime, meeting.id, track.id, 0, 0, 5_000, wavBytes);
  assert.equal(chunkRes.status, 202);
  const chunkId = chunkRes.body.chunk.id;

  // 测试单个 chunk 音频获取
  const chunkAudioRes = await runtime.handleHttp(request(`/chunks/${chunkId}/audio`));
  assert.equal(chunkAudioRes.status, 200);
  assert.ok(chunkAudioRes.body instanceof Buffer || chunkAudioRes.body instanceof Uint8Array);

  // 测试整场会议音频获取
  const meetingAudioRes = await runtime.handleHttp(request(`/meetings/${meeting.id}/audio`));
  assert.equal(meetingAudioRes.status, 200);
  assert.equal(meetingAudioRes.headers["content-type"], "audio/wav");
  assert.ok(meetingAudioRes.body.byteLength > 0);

  // 等待转写失败
  const failedMeeting = await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting,
    (m) => m.completeness.failedChunks.length > 0
  );
  assert.equal(failedMeeting.completeness.failedChunks.length, 1);

  // 模拟配置好 STT 后进行重试
  failTranscription = false;
  const retryRes = await runtime.handleHttp(request(`/meetings/${meeting.id}/retry-transcription`, { method: "POST", body: "{}" }));
  assert.equal(retryRes.status, 202);

  // 等待重试成功
  const recoveredMeeting = await waitFor(
    async () => (await runtime.handleHttp(request(`/meetings/${meeting.id}`))).body.meeting,
    (m) => m.completeness.failedChunks.length === 0 && m.utterances.length > 0
  );
  assert.equal(recoveredMeeting.utterances[0].text, "Meeting transcript text");

  runtime.dispose();
});

test("meeting UI does not use modal dialogs and provides audio playback & export controls", () => {
  const source = readFileSync(new URL("./builtin/meeting-notes/ui/app.js", import.meta.url), "utf8");
  const markup = readFileSync(new URL("./builtin/meeting-notes/ui/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:confirm|prompt|alert)\s*\(/);
  assert.match(source, /dataset\.armed/);
  assert.match(source, /host-capability/);
  assert.match(source, /Settings → Mini Apps → AI/);
  assert.match(source, /设置 → 小程序 → AI/);
  assert.match(source, /\["recording", "paused", "transcribing", "finalizing", "summarizing", "queued"\]/);
  assert.match(source, /audio\.pause/);
  assert.match(source, /audio\.resume/);
  assert.match(source, /audio-player-card/);
  assert.match(source, /meeting-timeline/);
  assert.match(source, /download-audio-btn/);
  assert.match(source, /export-markdown-btn/);
  assert.match(source, /retry-transcription-btn/);
  assert.match(markup, /id="live-view"/);
  assert.match(markup, /id="history-view"/);
  assert.match(markup, /id="history-search"/);
  assert.match(markup, /role="tablist"/);
  assert.match(markup, /id="capture-health"/);
  assert.match(markup, /class="signal-bars"/);
  assert.match(markup, /id="history-count"/);
  assert.match(markup, /id="history-filters"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(source, /searchSequence/);
  assert.match(source, /searchDebounce/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(source, /setBusy\(/);
  assert.match(source, /document\.activeElement !== el\.live_title/);
  assert.doesNotMatch(source.match(/function renderCapture\(\) \{[\s\S]*?\n\}/)?.[0] || "", /finish_confirm\.hidden = true/);
  assert.doesNotMatch(source, /new MediaRecorder\(/);
  const runtime = readFileSync(new URL("./builtin/meeting-notes/server/index.mjs", import.meta.url), "utf8");
  assert.match(runtime, /meeting_notes_transcription_failed/);
  assert.match(runtime, /meeting_notes_summary_failed/);
});

