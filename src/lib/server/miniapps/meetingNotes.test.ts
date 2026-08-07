import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("meeting segments are idempotent, failures do not stop later segments, and retained audio is deleted with the meeting", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-notes-"));
  const transcribeCalls = new Map<string, number>();
  const runtime = createMeetingNotes({
    dataDir,
    ai: {
      async transcribe(input: { path: string }) {
        transcribeCalls.set(input.path, (transcribeCalls.get(input.path) ?? 0) + 1);
        if (input.path.endsWith(".ogg")) throw Object.assign(new Error("failed"), { code: "provider_failed" });
        return { text: "successful transcript", durationSeconds: 4 };
      },
      async generateText() {
        return { text: "# Summary\n\nGenerated", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
      }
    }
  });

  const created = await runtime.handleHttp(request("/meetings", { method: "POST", body: { title: "Design review" } }));
  const meetingId = created.body.meeting.id;
  const first = await runtime.handleHttp(request(`/segments/${meetingId}`, {
    method: "POST", query: { seq: ["0"] }, body: new Uint8Array([1, 2]), contentType: "audio/webm"
  }));
  const duplicate = await runtime.handleHttp(request(`/segments/${meetingId}`, {
    method: "POST", query: { seq: ["0"] }, body: new Uint8Array([9]), contentType: "audio/webm"
  }));
  assert.equal(duplicate.body.segment.id, first.body.segment.id);
  assert.equal(transcribeCalls.get(first.body.segment.audioPath), 1);

  const failed = await runtime.handleHttp(request(`/segments/${meetingId}`, {
    method: "POST", query: { seq: ["1"] }, body: new Uint8Array([3]), contentType: "audio/ogg"
  }));
  assert.equal(failed.body.segment.status, "failed");
  assert.equal(failed.body.segment.attempts, 3);

  const later = await runtime.handleHttp(request(`/segments/${meetingId}`, {
    method: "POST", query: { seq: ["2"] }, body: new Uint8Array([4]), contentType: "audio/webm"
  }));
  assert.equal(later.body.segment.status, "complete");

  const finished = await runtime.handleHttp(request(`/meetings/${meetingId}/finish`, { method: "POST", body: {} }));
  assert.equal(finished.body.meeting.status, "complete");
  assert.match(finished.body.meeting.summary, /Generated/);
  const retainedPath = join(dataDir, first.body.segment.audioPath);
  assert.equal(existsSync(retainedPath), true);

  await runtime.tools.delete({ id: meetingId });
  assert.equal(existsSync(retainedPath), false);
  runtime.dispose();
});

test("a restart terminalizes an unfinished meeting as interrupted", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-meeting-restart-"));
  const context = {
    dataDir,
    ai: {
      async transcribe() { return { text: "text", durationSeconds: 1 }; },
      async generateText() { return { text: "notes", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; }
    }
  };
  const before = createMeetingNotes(context);
  const created = await before.handleHttp(request("/meetings", { method: "POST", body: {} }));
  before.dispose();

  const after = createMeetingNotes(context);
  const loaded = await after.handleHttp(request(`/meetings/${created.body.meeting.id}`));
  assert.equal(loaded.body.meeting.status, "interrupted");
  after.dispose();
});

test("meeting UI uses inline destructive confirmation and handles device loss without iframe modals", () => {
  const source = readFileSync(new URL("./builtin/meeting-notes/ui/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:confirm|prompt|alert)\s*\(/);
  assert.match(source, /dataset\.armed/);
  assert.match(source, /addEventListener\("ended"/);
  assert.match(source, /Promise\.allSettled\(pending\)/);
});
