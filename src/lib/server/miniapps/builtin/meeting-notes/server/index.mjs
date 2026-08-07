import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ACTIVE_STATES = ["recording", "transcribing", "summarizing"];

function jsonText(value) { return String(value ?? "").trim(); }
function now() { return new Date().toISOString(); }

export default function create(context) {
  const db = new DatabaseSync(path.join(context.dataDir, "meetings.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, language TEXT, summary TEXT,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, audio_path TEXT NOT NULL, mime TEXT NOT NULL,
      bytes INTEGER NOT NULL, duration_seconds REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL, text TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(meeting_id, seq)
    );
  `);
  db.prepare(`UPDATE meetings SET status='interrupted', error='Processing was interrupted by a service restart.', updated_at=? WHERE status IN ('recording','transcribing','summarizing')`).run(now());
  db.prepare(`UPDATE segments SET status='interrupted', error='Processing was interrupted by a service restart.', updated_at=? WHERE status='transcribing'`).run(now());

  const meetingRow = (row) => row && ({
    id: row.id, title: row.title, status: row.status, startedAt: row.started_at,
    endedAt: row.ended_at, language: row.language || "", summary: row.summary || "",
    error: row.error || "", createdAt: row.created_at, updatedAt: row.updated_at
  });
  const segmentRow = (row) => row && ({
    id: row.id, meetingId: row.meeting_id, seq: row.seq, audioPath: row.audio_path,
    mime: row.mime, bytes: row.bytes, durationSeconds: row.duration_seconds,
    status: row.status, text: row.text || "", attempts: row.attempts,
    error: row.error || "", createdAt: row.created_at, updatedAt: row.updated_at
  });
  const getMeeting = (id) => meetingRow(db.prepare("SELECT * FROM meetings WHERE id=?").get(id));
  const getSegments = (id) => db.prepare("SELECT * FROM segments WHERE meeting_id=? ORDER BY seq").all(id).map(segmentRow);
  const detail = (id) => {
    const meeting = getMeeting(id);
    return meeting ? { ...meeting, segments: getSegments(id) } : null;
  };
  const list = () => db.prepare("SELECT * FROM meetings ORDER BY created_at DESC").all().map(meetingRow);

  function createMeeting(input = {}) {
    const stamp = now();
    const id = randomUUID();
    const title = jsonText(input.title) || `Meeting ${stamp.slice(0, 16).replace("T", " ")}`;
    const language = jsonText(input.language);
    db.prepare("INSERT INTO meetings (id,title,status,started_at,language,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, title.slice(0, 200), "recording", stamp, language, stamp, stamp);
    return detail(id);
  }

  async function transcribeSegment(segment) {
    db.prepare("UPDATE segments SET status='transcribing', attempts=attempts+1, error=NULL, updated_at=? WHERE id=?").run(now(), segment.id);
    const current = segmentRow(db.prepare("SELECT * FROM segments WHERE id=?").get(segment.id));
    try {
      const result = await context.ai.transcribe({ path: current.audioPath, language: getMeeting(current.meetingId)?.language || undefined });
      db.prepare("UPDATE segments SET status='complete', text=?, duration_seconds=?, error=NULL, updated_at=? WHERE id=?")
        .run(result.text, result.durationSeconds, now(), current.id);
      return segmentRow(db.prepare("SELECT * FROM segments WHERE id=?").get(current.id));
    } catch (error) {
      const attempts = current.attempts;
      const retry = attempts < 3;
      db.prepare("UPDATE segments SET status=?, error=?, updated_at=? WHERE id=?")
        .run(retry ? "queued" : "failed", error?.code || "transcription_failed", now(), current.id);
      if (retry) return transcribeSegment(segmentRow(db.prepare("SELECT * FROM segments WHERE id=?").get(current.id)));
      return segmentRow(db.prepare("SELECT * FROM segments WHERE id=?").get(current.id));
    }
  }

  async function addSegment(meetingId, seq, body, mime) {
    const meeting = getMeeting(meetingId);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    const existing = db.prepare("SELECT * FROM segments WHERE meeting_id=? AND seq=?").get(meetingId, seq);
    if (existing) return segmentRow(existing);
    if (!(body instanceof Uint8Array) || body.byteLength === 0) throw Object.assign(new Error("Audio body is required."), { status: 400 });
    const extension = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : "webm";
    const relative = `audio/${meetingId}/${randomUUID()}.${extension}`;
    const absolute = path.join(context.dataDir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, body);
    const stamp = now();
    const id = randomUUID();
    try {
      db.prepare("INSERT INTO segments (id,meeting_id,seq,audio_path,mime,bytes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, meetingId, seq, relative, mime, body.byteLength, "queued", stamp, stamp);
    } catch (error) {
      fs.rmSync(absolute, { force: true });
      const raced = db.prepare("SELECT * FROM segments WHERE meeting_id=? AND seq=?").get(meetingId, seq);
      if (raced) return segmentRow(raced);
      throw error;
    }
    db.prepare("UPDATE meetings SET status='transcribing', updated_at=? WHERE id=?").run(stamp, meetingId);
    return transcribeSegment(segmentRow(db.prepare("SELECT * FROM segments WHERE id=?").get(id)));
  }

  /**
   * Raises the sidebar badge because a meeting's notes just became readable.
   *
   * This is the whole point of the badge seam: transcription and summarizing
   * finish long after the owner walked away, and the panel is the only place
   * that says so. Deliberately quiet — a count on the icon, never a system
   * notification.
   *
   * The host clears the badge when the panel is opened, so a null badge means
   * "everything so far has been seen" and the count restarts from there. That
   * keeps the number meaning "ready since you last looked" instead of growing
   * forever. `?.` throughout: an older host has no `badge` at all.
   */
  function announceReady() {
    const current = context.badge?.get?.() ?? null;
    const unseen = current && current.kind === "count" ? current.count : 0;
    context.badge?.set({ kind: "count", count: unseen + 1 });
  }

  /** Display-only summary card; its one affordance is a link into this app. */
  function meetingCard(meeting, subtitle) {
    const segments = getSegments(meeting.id);
    const failed = segments.filter((segment) => segment.status === "failed").length;
    return {
      title: meeting.title || "Meeting",
      subtitle,
      icon: "microphone",
      fields: [
        { label: "Segments", value: String(segments.length) },
        ...(failed ? [{ label: "Failed", value: String(failed) }] : [])
      ],
      link: `molibot://miniapp/${context.appId}/meeting/${encodeURIComponent(meeting.id)}`
    };
  }

  async function regenerate(id) {
    const meeting = getMeeting(id);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    const segments = getSegments(id).filter((segment) => segment.status === "complete" && segment.text);
    if (!segments.length) throw Object.assign(new Error("No completed transcript is available."), { status: 409 });
    db.prepare("UPDATE meetings SET status='summarizing', error=NULL, updated_at=? WHERE id=?").run(now(), id);
    try {
      const transcript = segments.map((segment) => `[${segment.seq}] ${segment.text}`).join("\n\n");
      const result = await context.ai.generateText({
        system: "Create concise Markdown meeting notes. Use exactly these sections: Summary, Key Decisions, Action Items, Full Transcript. Do not invent details.",
        prompt: `Meeting title: ${meeting.title}\n\n${transcript}`,
        maxTokens: 4096
      });
      db.prepare("UPDATE meetings SET status='complete', summary=?, error=NULL, updated_at=? WHERE id=?").run(result.text, now(), id);
      announceReady();
    } catch (error) {
      db.prepare("UPDATE meetings SET status='failed', error=?, updated_at=? WHERE id=?").run(error?.code || "summary_failed", now(), id);
      throw error;
    }
    return detail(id);
  }

  async function finish(id) {
    const meeting = getMeeting(id);
    if (!meeting) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    db.prepare("UPDATE meetings SET ended_at=?, status='transcribing', updated_at=? WHERE id=?").run(now(), now(), id);
    return regenerate(id);
  }

  function rename(id, title) {
    const value = jsonText(title);
    if (!value) throw Object.assign(new Error("Title is required."), { status: 400 });
    const result = db.prepare("UPDATE meetings SET title=?, updated_at=? WHERE id=?").run(value.slice(0, 200), now(), id);
    if (!result.changes) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    return detail(id);
  }

  function remove(id) {
    if (!getMeeting(id)) throw Object.assign(new Error("Meeting not found."), { status: 404 });
    db.prepare("DELETE FROM meetings WHERE id=?").run(id);
    fs.rmSync(path.join(context.dataDir, "audio", id), { recursive: true, force: true });
  }

  async function retrySegment(id) {
    const segment = segmentRow(db.prepare("SELECT * FROM segments WHERE id=?").get(id));
    if (!segment) throw Object.assign(new Error("Segment not found."), { status: 404 });
    if (!fs.existsSync(path.join(context.dataDir, segment.audioPath))) throw Object.assign(new Error("Retained audio is missing."), { status: 409 });
    db.prepare("UPDATE segments SET status='queued', attempts=0, error=NULL, updated_at=? WHERE id=?").run(now(), id);
    return transcribeSegment(segmentRow(db.prepare("SELECT * FROM segments WHERE id=?").get(id)));
  }

  async function route(request) {
    const parts = request.path.split("/").filter(Boolean);
    try {
      if (request.path === "/meetings" && request.method === "GET") return { body: { meetings: list() } };
      if (request.path === "/meetings" && request.method === "POST") return { status: 201, body: { meeting: createMeeting(request.body) }, changed: true };
      if (parts[0] === "meetings" && parts[1] && parts.length === 2 && request.method === "GET") return { body: { meeting: detail(parts[1]) } };
      if (parts[0] === "meetings" && parts[2] === "finish" && request.method === "POST") return { body: { meeting: await finish(parts[1]) }, changed: true };
      if (parts[0] === "meetings" && parts[2] === "regenerate" && request.method === "POST") return { body: { meeting: await regenerate(parts[1]) }, changed: true };
      if (parts[0] === "meetings" && parts[1] && parts.length === 2 && request.method === "PATCH") return { body: { meeting: rename(parts[1], request.body?.title) }, changed: true };
      if (parts[0] === "meetings" && parts[1] && parts.length === 2 && request.method === "DELETE") { remove(parts[1]); return { body: { ok: true }, changed: true }; }
      if (parts[0] === "segments" && parts[1] && request.method === "POST") {
        const seq = Number(request.query.seq?.[0]);
        if (!Number.isInteger(seq) || seq < 0) throw Object.assign(new Error("seq must be a non-negative integer."), { status: 400 });
        return { status: 201, body: { segment: await addSegment(parts[1], seq, request.body, request.contentType || "application/octet-stream") }, changed: true };
      }
      if (parts[0] === "segments" && parts[2] === "retry" && request.method === "POST") return { body: { segment: await retrySegment(parts[1]) }, changed: true };
      return { status: 404, body: { error: "Not found." } };
    } catch (error) {
      if (error?.status) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }

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
        const meeting = await regenerate(id);
        return {
          content: [{ type: "text", text: "Meeting notes regenerated." }],
          structuredContent: meeting,
          changed: true,
          ...(getMeeting(id) ? { card: meetingCard(getMeeting(id), "Notes regenerated") } : {})
        };
      },
      delete: async ({ id }) => { remove(id); return { content: [{ type: "text", text: "Meeting permanently deleted." }], changed: true }; }
    },
    handleHttp: route,
    dispose() { db.close(); }
  };
}
