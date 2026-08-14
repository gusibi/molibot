import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DB_SCHEMA_VERSION = 2;
const MAX_TRANSCRIPTIONS = 2;
const MAX_TRACK_SEQ = 100_000;
const SUMMARY_WINDOW_CHARS = 8_000;
const SUMMARY_REDUCE_CHARS = 12_000;
const LIVE_NOTES_INTERVAL_MS = 60_000;
const LIVE_NOTES_EVIDENCE_CHARS = 6_000;
const RETRY_DELAYS_MS = [1_000, 3_000];
const RETRYABLE_AI_ERRORS = new Set(["provider_failed", "rate_limited"]);

function text(value) { return String(value ?? "").trim(); }
function now() { return new Date().toISOString(); }
function int(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error(`${name} must be an integer between ${min} and ${max}.`), { status: 400 });
  }
  return parsed;
}
function backupStamp() { return new Date().toISOString().replace(/[^0-9]/g, ""); }

function prepareV2Storage(context) {
  const dbPath = path.join(context.dataDir, "meetings.sqlite");
  if (!fs.existsSync(dbPath)) return;
  let version = 0;
  try {
    const probe = new DatabaseSync(dbPath);
    version = Number(probe.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    probe.close();
  } catch {
    version = 0;
  }
  if (version === DB_SCHEMA_VERSION) return;

  const stamp = backupStamp();
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${dbPath}${suffix}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${dbPath}.backup-${stamp}${suffix}`);
  }
  const audioDir = path.join(context.dataDir, "audio");
  if (fs.existsSync(audioDir)) fs.renameSync(audioDir, path.join(context.dataDir, `audio.backup-${stamp}`));
  context.logger?.warn?.("meeting_notes_schema_reset", { from: version, to: DB_SCHEMA_VERSION });
}

function splitBounded(value, maxChars) {
  const source = text(value);
  if (!source) return [];
  const parts = [];
  for (let offset = 0; offset < source.length; offset += maxChars) {
    parts.push(source.slice(offset, offset + maxChars));
  }
  return parts;
}

function groupBounded(items, maxChars) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const item of items.flatMap((value) => splitBounded(value, maxChars))) {
    if (current.length && size + item.length > maxChars) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.length;
  }
  if (current.length) groups.push(current);
  return groups;
}

export default function create(context) {
  fs.mkdirSync(context.dataDir, { recursive: true });
  prepareV2Storage(context);
  const db = new DatabaseSync(path.join(context.dataDir, "meetings.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary TEXT NOT NULL DEFAULT '',
      live_notes TEXT NOT NULL DEFAULT '',
      live_notes_through_ms INTEGER NOT NULL DEFAULT 0,
      summary_completeness TEXT NOT NULL DEFAULT 'none',
      capture_warning TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      sample_rate INTEGER,
      channels INTEGER,
      expected_last_seq INTEGER,
      end_ms INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audio_chunks (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      audio_path TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      duration_seconds REAL NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(track_id, seq),
      CHECK(end_ms > start_ms)
    );
    CREATE TABLE IF NOT EXISTS utterances (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      chunk_id TEXT NOT NULL REFERENCES audio_chunks(id) ON DELETE CASCADE,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      speaker_label TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      confidence REAL,
      is_final INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(chunk_id)
    );
    CREATE INDEX IF NOT EXISTS audio_chunks_queue_idx ON audio_chunks(status, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS utterances_timeline_idx ON utterances(meeting_id, start_ms, end_ms);
    PRAGMA user_version=2;
  `);

  const recoveredAt = now();
  db.prepare("UPDATE audio_chunks SET status='queued', next_attempt_at=NULL, error='', updated_at=? WHERE status='transcribing'").run(recoveredAt);
  db.prepare("UPDATE meetings SET status='finalizing', error='', updated_at=? WHERE status='summarizing'").run(recoveredAt);
  db.prepare("UPDATE meetings SET status='interrupted', error='Recording was interrupted. Saved audio is still available.', updated_at=? WHERE status IN ('recording','paused')").run(recoveredAt);

  let disposed = false;
  let pumpScheduled = false;
  let activeTranscriptions = 0;
  let retryTimer = null;
  const liveNoteJobs = new Set();

  const meetingRow = (row) => row && ({
    id: row.id,
    title: row.title,
    status: row.status,
    language: row.language,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    summary: row.summary,
    liveNotes: row.live_notes,
    liveNotesThroughMs: row.live_notes_through_ms,
    summaryCompleteness: row.summary_completeness,
    captureWarning: row.capture_warning,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
  const trackRow = (row) => row && ({
    id: row.id,
    meetingId: row.meeting_id,
    sourceKind: row.source_kind,
    label: row.label,
    sampleRate: row.sample_rate,
    channels: row.channels,
    expectedLastSeq: row.expected_last_seq,
    endMs: row.end_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
  const chunkRow = (row) => row && ({
    id: row.id,
    meetingId: row.meeting_id,
    trackId: row.track_id,
    seq: row.seq,
    startMs: row.start_ms,
    endMs: row.end_ms,
    audioPath: row.audio_path,
    mime: row.mime,
    bytes: row.bytes,
    status: row.status,
    text: row.text,
    durationSeconds: row.duration_seconds,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
  const utteranceRow = (row) => row && ({
    id: row.id,
    meetingId: row.meeting_id,
    trackId: row.track_id,
    chunkId: row.chunk_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    speakerLabel: row.speaker_label,
    text: row.text,
    confidence: row.confidence,
    isFinal: Boolean(row.is_final),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  const getMeeting = (id) => meetingRow(db.prepare("SELECT * FROM meetings WHERE id=?").get(id));
  const getTracks = (id) => db.prepare("SELECT * FROM tracks WHERE meeting_id=? ORDER BY created_at, id").all(id).map(trackRow);
  const getChunks = (id) => db.prepare("SELECT * FROM audio_chunks WHERE meeting_id=? ORDER BY start_ms, track_id, seq").all(id).map(chunkRow);
  const getUtterances = (id) => db.prepare("SELECT * FROM utterances WHERE meeting_id=? ORDER BY start_ms, end_ms, id").all(id).map(utteranceRow);

  function completeness(meetingId) {
    const tracks = getTracks(meetingId);
    const chunks = getChunks(meetingId);
    const byTrack = new Map();
    for (const chunk of chunks) {
      if (!byTrack.has(chunk.trackId)) byTrack.set(chunk.trackId, new Set());
      byTrack.get(chunk.trackId).add(chunk.seq);
    }
    const missingChunks = [];
    for (const track of tracks) {
      if (track.expectedLastSeq === null) continue;
      const present = byTrack.get(track.id) ?? new Set();
      for (let seq = 0; seq <= track.expectedLastSeq; seq += 1) {
        if (!present.has(seq)) missingChunks.push({ trackId: track.id, seq });
      }
    }
    return {
      missingChunks,
      failedChunks: chunks.filter((chunk) => chunk.status === "failed").map((chunk) => ({ id: chunk.id, trackId: chunk.trackId, seq: chunk.seq, error: chunk.error })),
      pendingChunks: chunks.filter((chunk) => chunk.status === "queued" || chunk.status === "transcribing").map((chunk) => ({ id: chunk.id, trackId: chunk.trackId, seq: chunk.seq, status: chunk.status }))
    };
  }

  function detail(id) {
    const meeting = getMeeting(id);
    if (!meeting) return null;
    return {
      ...meeting,
      tracks: getTracks(id),
      chunks: getChunks(id),
      utterances: getUtterances(id),
      completeness: completeness(id)
    };
  }

  const list = (query = "") => {
    const needle = text(query).toLowerCase();
    const pattern = `%${needle}%`;
    return db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM tracks t WHERE t.meeting_id=m.id) AS track_count,
      (SELECT COUNT(*) FROM audio_chunks c WHERE c.meeting_id=m.id) AS chunk_count,
      COALESCE((SELECT MAX(t.end_ms) FROM tracks t WHERE t.meeting_id=m.id), 0) AS duration_ms
    FROM meetings m
    WHERE ?='' OR lower(m.title) LIKE ? OR lower(m.summary) LIKE ? OR lower(m.live_notes) LIKE ?
      OR EXISTS (SELECT 1 FROM utterances u WHERE u.meeting_id=m.id AND lower(u.text) LIKE ?)
    ORDER BY m.created_at DESC
  `).all(needle, pattern, pattern, pattern, pattern).map((row) => ({
      ...meetingRow(row),
      trackCount: row.track_count,
      chunkCount: row.chunk_count,
      durationMs: row.duration_ms
    }));
  };

  function createMeeting(input = {}) {
    const stamp = now();
    const meetingId = randomUUID();
    const trackId = randomUUID();
    const title = text(input.title) || `Meeting ${stamp.slice(0, 16).replace("T", " ")}`;
    const language = text(input.language);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO meetings (id,title,status,language,started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run(meetingId, title.slice(0, 200), "recording", language, stamp, stamp, stamp);
      db.prepare("INSERT INTO tracks (id,meeting_id,source_kind,label,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run(trackId, meetingId, "microphone", "Microphone", stamp, stamp);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { meeting: detail(meetingId), track: trackRow(db.prepare("SELECT * FROM tracks WHERE id=?").get(trackId)) };
  }

  function extensionFor(mime) {
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("mpeg")) return "mp3";
    if (mime.includes("wav")) return "wav";
    if (mime.includes("flac")) return "flac";
    return "webm";
  }

  function addChunk(meetingId, input, body, mime) {
    const meeting = getMeeting(meetingId);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    const trackId = text(input.trackId);
    const track = trackRow(db.prepare("SELECT * FROM tracks WHERE id=? AND meeting_id=?").get(trackId, meetingId));
    if (!track) throw Object.assign(new Error("Track not found for this meeting."), { status: 404 });
    const seq = int(input.seq, "seq", { max: MAX_TRACK_SEQ });
    const startMs = int(input.startMs, "startMs", { max: Number.MAX_SAFE_INTEGER });
    const endMs = int(input.endMs, "endMs", { min: startMs + 1, max: Number.MAX_SAFE_INTEGER });
    if (!(body instanceof Uint8Array) || body.byteLength === 0) throw Object.assign(new Error("Audio body is required."), { status: 400 });
    const sha256 = createHash("sha256").update(body).digest("hex");
    const existing = chunkRow(db.prepare("SELECT * FROM audio_chunks WHERE track_id=? AND seq=?").get(trackId, seq));
    if (existing) {
      const row = db.prepare("SELECT sha256 FROM audio_chunks WHERE id=?").get(existing.id);
      if (row.sha256 !== sha256 || existing.startMs !== startMs || existing.endMs !== endMs) {
        throw Object.assign(new Error("Chunk sequence already exists with different audio or timing."), { status: 409 });
      }
      return existing;
    }

    const relative = `audio/${meetingId}/${trackId}/${String(seq).padStart(8, "0")}-${randomUUID()}.${extensionFor(mime)}`;
    const absolute = path.join(context.dataDir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, body);
    const stamp = now();
    const id = randomUUID();
    try {
      db.prepare(`INSERT INTO audio_chunks
        (id,meeting_id,track_id,seq,start_ms,end_ms,audio_path,mime,bytes,sha256,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, meetingId, trackId, seq, startMs, endMs, relative, mime, body.byteLength, sha256, "queued", stamp, stamp);
    } catch (error) {
      fs.rmSync(absolute, { force: true });
      const raced = chunkRow(db.prepare("SELECT * FROM audio_chunks WHERE track_id=? AND seq=?").get(trackId, seq));
      if (raced) return raced;
      throw error;
    }
    schedulePump();
    return chunkRow(db.prepare("SELECT * FROM audio_chunks WHERE id=?").get(id));
  }

  function nextQueuedChunk() {
    return chunkRow(db.prepare(`
      SELECT * FROM audio_chunks
      WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY created_at, track_id, seq LIMIT 1
    `).get(now()));
  }

  function scheduleRetryWakeup() {
    if (disposed || retryTimer) return;
    const next = db.prepare("SELECT next_attempt_at FROM audio_chunks WHERE status='queued' AND next_attempt_at IS NOT NULL ORDER BY next_attempt_at LIMIT 1").get();
    if (!next?.next_attempt_at) return;
    const delay = Math.max(1, new Date(next.next_attempt_at).getTime() - Date.now());
    retryTimer = setTimeout(() => {
      retryTimer = null;
      schedulePump();
    }, delay);
    retryTimer.unref?.();
  }

  function schedulePump() {
    if (disposed || pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  }

  function pump() {
    if (disposed) return;
    while (activeTranscriptions < MAX_TRANSCRIPTIONS) {
      const queued = nextQueuedChunk();
      if (!queued) break;
      const changed = db.prepare("UPDATE audio_chunks SET status='transcribing', attempts=attempts+1, next_attempt_at=NULL, error='', updated_at=? WHERE id=? AND status='queued'")
        .run(now(), queued.id);
      if (!changed.changes) continue;
      activeTranscriptions += 1;
      void transcribeChunk(queued.id)
        .catch((error) => context.logger?.error?.("meeting_notes_chunk_worker_failed", { chunkId: queued.id, error: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          activeTranscriptions -= 1;
          schedulePump();
        });
    }
    scheduleRetryWakeup();
  }

  function scheduleLiveNotes(meetingId) {
    if (disposed || liveNoteJobs.has(meetingId)) return;
    liveNoteJobs.add(meetingId);
    void updateLiveNotes(meetingId)
      .then(() => true)
      .catch((error) => {
        context.logger?.warn?.("meeting_notes_live_summary_failed", {
          meetingId,
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      })
      .then((succeeded) => {
        liveNoteJobs.delete(meetingId);
        if (!succeeded || disposed) return;
        const meeting = getMeeting(meetingId);
        const latest = Number(db.prepare("SELECT COALESCE(MAX(end_ms),0) AS end_ms FROM utterances WHERE meeting_id=?").get(meetingId)?.end_ms ?? 0);
        if (meeting?.status === "recording" && latest - meeting.liveNotesThroughMs >= LIVE_NOTES_INTERVAL_MS) {
          queueMicrotask(() => scheduleLiveNotes(meetingId));
        }
      });
  }

  async function updateLiveNotes(meetingId) {
    const meeting = getMeeting(meetingId);
    if (!meeting || meeting.status !== "recording") return;
    const latest = Number(db.prepare("SELECT COALESCE(MAX(end_ms),0) AS end_ms FROM utterances WHERE meeting_id=?").get(meetingId)?.end_ms ?? 0);
    if (latest - meeting.liveNotesThroughMs < LIVE_NOTES_INTERVAL_MS) return;
    const evidence = getUtterances(meetingId)
      .filter((item) => item.endMs > meeting.liveNotesThroughMs)
      .map((item) => `[${item.startMs}-${item.endMs}ms] ${item.text}`)
      .join("\n")
      .slice(-LIVE_NOTES_EVIDENCE_CHARS);
    if (!evidence) return;
    const result = await context.ai.generateText({
      system: "Maintain concise provisional meeting notes during a live meeting. Use Decisions, Action Items, and Open Questions. Only include evidence present in the input; never invent owners or deadlines.",
      prompt: `Meeting: ${meeting.title}\n\nPrevious provisional notes:\n${meeting.liveNotes.slice(-4_000) || "None yet."}\n\nNew transcript evidence:\n${evidence}`,
      maxTokens: 700
    });
    db.prepare("UPDATE meetings SET live_notes=?, live_notes_through_ms=?, updated_at=? WHERE id=? AND status='recording'")
      .run(text(result.text), latest, now(), meetingId);
  }

  async function transcribeChunk(chunkId) {
    const chunk = chunkRow(db.prepare("SELECT * FROM audio_chunks WHERE id=?").get(chunkId));
    if (!chunk) return;
    try {
      const meeting = getMeeting(chunk.meetingId);
      const result = await context.ai.transcribe({ path: chunk.audioPath, language: meeting?.language || undefined });
      const transcript = text(result.text);
      if (!transcript) throw Object.assign(new Error("Transcription returned no text."), { code: "provider_failed" });
      const stamp = now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE audio_chunks SET status='complete', text=?, duration_seconds=?, error='', next_attempt_at=NULL, updated_at=? WHERE id=?")
          .run(transcript, Number(result.durationSeconds ?? 0), stamp, chunkId);
        db.prepare("DELETE FROM utterances WHERE chunk_id=?").run(chunkId);
        db.prepare(`INSERT INTO utterances
          (id,meeting_id,track_id,chunk_id,start_ms,end_ms,speaker_label,text,confidence,is_final,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(randomUUID(), chunk.meetingId, chunk.trackId, chunk.id, chunk.startMs, chunk.endMs, "", transcript, null, 1, stamp, stamp);
        db.exec("COMMIT");
        scheduleLiveNotes(chunk.meetingId);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      const current = chunkRow(db.prepare("SELECT * FROM audio_chunks WHERE id=?").get(chunkId));
      if (!current) return;
      const code = text(error?.code) || "transcription_failed";
      context.logger?.warn?.("meeting_notes_transcription_failed", {
        meetingId: current.meetingId,
        chunkId,
        seq: current.seq,
        code
      });
      const retryIndex = current.attempts - 1;
      if (RETRYABLE_AI_ERRORS.has(code) && retryIndex < RETRY_DELAYS_MS.length) {
        const nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[retryIndex]).toISOString();
        db.prepare("UPDATE audio_chunks SET status='queued', next_attempt_at=?, error=?, updated_at=? WHERE id=?")
          .run(nextAttemptAt, code, now(), chunkId);
      } else {
        db.prepare("UPDATE audio_chunks SET status='failed', next_attempt_at=NULL, error=?, updated_at=? WHERE id=?")
          .run(code, now(), chunkId);
      }
    }
    await maybeFinalize(chunk.meetingId);
  }

  function finish(meetingId, input = {}) {
    const meeting = getMeeting(meetingId);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    if (!Array.isArray(input.tracks) || input.tracks.length === 0) {
      throw Object.assign(new Error("tracks must describe every completed capture track."), { status: 400 });
    }
    const tracks = getTracks(meetingId);
    const submitted = new Map(input.tracks.map((item) => [text(item?.id), item]));
    if (tracks.some((track) => !submitted.has(track.id)) || submitted.size !== tracks.length) {
      throw Object.assign(new Error("tracks must describe every completed capture track exactly once."), { status: 400 });
    }
    const stamp = now();
    const captureWarning = text(input.captureError).slice(0, 500);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const track of tracks) {
        const value = submitted.get(track.id);
        const expectedLastSeq = int(value.expectedLastSeq, "expectedLastSeq", { max: MAX_TRACK_SEQ });
        const endMs = int(value.endMs, "endMs", { min: 1, max: Number.MAX_SAFE_INTEGER });
        db.prepare("UPDATE tracks SET expected_last_seq=?, end_ms=?, updated_at=? WHERE id=?")
          .run(expectedLastSeq, endMs, stamp, track.id);
      }
      db.prepare("UPDATE meetings SET status='finalizing', ended_at=COALESCE(ended_at,?), summary_completeness='none', capture_warning=?, error='', updated_at=? WHERE id=?")
        .run(stamp, captureWarning, stamp, meetingId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    schedulePump();
    void maybeFinalize(meetingId);
    return detail(meetingId);
  }

  async function summarizeWindow(parts, title) {
    const prompt = `Meeting title: ${title}\n\nFinal transcript evidence:\n\n${parts.join("\n\n")}`;
    const result = await context.ai.generateText({
      system: "Create evidence-grounded Markdown meeting notes. Use Summary, Key Decisions, Action Items, and Open Questions. Preserve source markers. Never invent names, owners, deadlines, or facts.",
      prompt,
      maxTokens: 1400
    });
    return text(result.text);
  }

  async function reduceSummaries(summaries, title) {
    let current = summaries;
    while (current.length > 1) {
      const groups = groupBounded(current, SUMMARY_REDUCE_CHARS);
      const next = [];
      for (const group of groups) {
        const result = await context.ai.generateText({
          system: "Merge these evidence-grounded partial meeting notes into concise Markdown. Keep Summary, Key Decisions, Action Items, and Open Questions. Preserve source markers and do not invent details.",
          prompt: `Meeting title: ${title}\n\nPartial notes:\n\n${group.join("\n\n---\n\n")}`,
          maxTokens: 1800
        });
        next.push(text(result.text));
      }
      if (next.length === current.length && next.length > 1) {
        current = [await summarizeWindow(next, title)];
      } else {
        current = next;
      }
    }
    return current[0] || "";
  }

  async function summarizeMeeting(meetingId) {
    const meeting = getMeeting(meetingId);
    if (!meeting) return;
    try {
      const utterances = getUtterances(meetingId);
      const evidence = utterances.map((item) => `[u:${item.id} ${item.startMs}-${item.endMs}ms] ${item.speakerLabel ? `${item.speakerLabel}: ` : ""}${item.text}`);
      let summary = "# Summary\n\nNo transcript was available.\n\n# Key Decisions\n\n- None captured.\n\n# Action Items\n\n- None captured.\n\n# Open Questions\n\n- None captured.";
      if (evidence.length) {
        const windows = groupBounded(evidence, SUMMARY_WINDOW_CHARS);
        const partials = [];
        for (const window of windows) partials.push(await summarizeWindow(window, meeting.title));
        summary = await reduceSummaries(partials, meeting.title);
      }
      const state = completeness(meetingId);
      const partial = state.missingChunks.length > 0 || state.failedChunks.length > 0 || Boolean(meeting.captureWarning);
      db.prepare("UPDATE meetings SET status=?, summary=?, summary_completeness=?, error='', updated_at=? WHERE id=?")
        .run(partial ? "partial" : "ready", summary, partial ? "partial" : "complete", now(), meetingId);
      announceReady();
    } catch (error) {
      const code = text(error?.code) || "summary_failed";
      context.logger?.error?.("meeting_notes_summary_failed", { meetingId, code });
      db.prepare("UPDATE meetings SET status='failed', error=?, updated_at=? WHERE id=?")
        .run(code, now(), meetingId);
    }
  }

  async function maybeFinalize(meetingId) {
    if (disposed) return;
    const meeting = getMeeting(meetingId);
    if (!meeting || meeting.status !== "finalizing") return;
    const pending = db.prepare("SELECT COUNT(*) AS count FROM audio_chunks WHERE meeting_id=? AND status IN ('queued','transcribing')").get(meetingId).count;
    if (Number(pending) > 0) return;
    const changed = db.prepare("UPDATE meetings SET status='summarizing', updated_at=? WHERE id=? AND status='finalizing'").run(now(), meetingId);
    if (!changed.changes) return;
    await summarizeMeeting(meetingId);
  }

  function regenerate(meetingId) {
    const meeting = getMeeting(meetingId);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    if (["recording", "paused"].includes(meeting.status)) throw Object.assign(new Error("Stop the active recording before regenerating notes."), { status: 409 });
    db.prepare("UPDATE meetings SET status='finalizing', summary_completeness='none', error='', updated_at=? WHERE id=?")
      .run(now(), meetingId);
    void maybeFinalize(meetingId);
    return detail(meetingId);
  }

  function setCaptureState(meetingId, target) {
    const meeting = getMeeting(meetingId);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    const allowed = ["recording", "paused", ...(!meeting.endedAt ? ["interrupted"] : [])];
    if (!allowed.includes(meeting.status)) {
      throw Object.assign(new Error("This meeting is no longer active."), { status: 409 });
    }
    if (meeting.status !== target) {
      db.prepare("UPDATE meetings SET status=?, error='', updated_at=? WHERE id=?").run(target, now(), meetingId);
    }
    return detail(meetingId);
  }

  function rename(meetingId, title) {
    const value = text(title);
    if (!value) throw Object.assign(new Error("Title is required."), { status: 400 });
    const result = db.prepare("UPDATE meetings SET title=?, updated_at=? WHERE id=?").run(value.slice(0, 200), now(), meetingId);
    if (!result.changes) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    return detail(meetingId);
  }

  function retryChunk(chunkId) {
    const chunk = chunkRow(db.prepare("SELECT * FROM audio_chunks WHERE id=?").get(chunkId));
    if (!chunk) throw Object.assign(new Error("Chunk not found."), { status: 404 });
    if (!fs.existsSync(path.join(context.dataDir, chunk.audioPath))) throw Object.assign(new Error("Retained audio is missing."), { status: 409 });
    db.prepare("UPDATE audio_chunks SET status='queued', attempts=0, next_attempt_at=NULL, error='', updated_at=? WHERE id=?")
      .run(now(), chunkId);
    const meeting = getMeeting(chunk.meetingId);
    if (meeting?.endedAt) db.prepare("UPDATE meetings SET status='finalizing', error='', updated_at=? WHERE id=?").run(now(), chunk.meetingId);
    schedulePump();
    return chunkRow(db.prepare("SELECT * FROM audio_chunks WHERE id=?").get(chunkId));
  }

  function remove(meetingId) {
    const meeting = getMeeting(meetingId);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    if (["recording", "paused"].includes(meeting.status)) throw Object.assign(new Error("Stop the active recording before deleting this meeting."), { status: 409 });
    db.prepare("DELETE FROM meetings WHERE id=?").run(meetingId);
    fs.rmSync(path.join(context.dataDir, "audio", meetingId), { recursive: true, force: true });
  }

  function announceReady() {
    const current = context.badge?.get?.() ?? null;
    const unseen = current && current.kind === "count" ? current.count : 0;
    context.badge?.set({ kind: "count", count: unseen + 1 });
  }

  function meetingCard(meeting, subtitle) {
    const state = completeness(meeting.id);
    return {
      title: meeting.title || "Meeting",
      subtitle,
      icon: "microphone",
      fields: [
        { label: "Tracks", value: String(getTracks(meeting.id).length) },
        { label: "Chunks", value: String(getChunks(meeting.id).length) },
        ...(state.missingChunks.length ? [{ label: "Missing", value: String(state.missingChunks.length) }] : []),
        ...(state.failedChunks.length ? [{ label: "Failed", value: String(state.failedChunks.length) }] : [])
      ],
      link: `molibot://miniapp/${context.appId}/meeting/${encodeURIComponent(meeting.id)}`
    };
  }

  async function route(request) {
    const parts = request.path.split("/").filter(Boolean);
    try {
      if (request.path === "/meetings" && request.method === "GET") return { body: { meetings: list(request.query.q?.[0]) } };
      if (request.path === "/meetings" && request.method === "POST") return { status: 201, body: createMeeting(request.body), changed: true };
      if (parts[0] === "meetings" && parts[1] && parts.length === 2 && request.method === "GET") return { body: { meeting: detail(parts[1]) } };
      if (parts[0] === "meetings" && parts[2] === "pause" && request.method === "POST") return { body: { meeting: setCaptureState(parts[1], "paused") }, changed: true };
      if (parts[0] === "meetings" && parts[2] === "resume" && request.method === "POST") return { body: { meeting: setCaptureState(parts[1], "recording") }, changed: true };
      if (parts[0] === "meetings" && parts[2] === "finish" && request.method === "POST") return { status: 202, body: { meeting: finish(parts[1], request.body) }, changed: true };
      if (parts[0] === "meetings" && parts[2] === "regenerate" && request.method === "POST") return { status: 202, body: { meeting: regenerate(parts[1]) }, changed: true };
      if (parts[0] === "meetings" && parts[1] && parts.length === 2 && request.method === "PATCH") return { body: { meeting: rename(parts[1], request.body?.title) }, changed: true };
      if (parts[0] === "meetings" && parts[1] && parts.length === 2 && request.method === "DELETE") { remove(parts[1]); return { body: { ok: true }, changed: true }; }
      if (parts[0] === "chunks" && parts[1] && parts.length === 2 && request.method === "POST") {
        const chunk = addChunk(parts[1], {
          trackId: request.query.trackId?.[0],
          seq: request.query.seq?.[0],
          startMs: request.query.startMs?.[0],
          endMs: request.query.endMs?.[0]
        }, request.body, request.contentType || "application/octet-stream");
        return { status: 202, body: { chunk }, changed: true };
      }
      if (parts[0] === "chunks" && parts[2] === "retry" && request.method === "POST") return { status: 202, body: { chunk: retryChunk(parts[1]) }, changed: true };
      return { status: 404, body: { error: "Not found." } };
    } catch (error) {
      if (error?.status) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }

  schedulePump();
  for (const meeting of list().filter((item) => item.status === "finalizing")) void maybeFinalize(meeting.id);

  return {
    tools: {
      list: async () => ({ content: [{ type: "text", text: `${list().length} meeting(s).` }], structuredContent: list() }),
      get: async ({ id }) => {
        const meeting = getMeeting(id);
        return {
          content: [{ type: "text", text: meeting?.summary || "Meeting found." }],
          structuredContent: detail(id),
          ...(meeting ? { card: meetingCard(meeting, meeting.status) } : {})
        };
      },
      regenerate: async ({ id }) => {
        const meeting = regenerate(id);
        return {
          content: [{ type: "text", text: "Meeting note regeneration started." }],
          structuredContent: meeting,
          changed: true,
          ...(getMeeting(id) ? { card: meetingCard(getMeeting(id), "Regenerating notes") } : {})
        };
      },
      delete: async ({ id }) => { remove(id); return { content: [{ type: "text", text: "Meeting permanently deleted." }], changed: true }; }
    },
    handleHttp: route,
    dispose() {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      db.close();
    }
  };
}
