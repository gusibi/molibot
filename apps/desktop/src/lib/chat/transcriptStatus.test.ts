import assert from "node:assert/strict";
import test from "node:test";
import { isStatusOnlyMessage, transcriptTurnStatuses } from "./transcriptStatus";
import type { TranscriptMessage } from "./transcript";
const user: TranscriptMessage = { role: "user", content: "Hello" };
const failure: TranscriptMessage = { role: "assistant", content: "", stopReason: "error", errorMessage: "401: API key expired" };

test("empty failures remain system status; multiple failed requests form one failed turn", () => {
  const rows = [user, failure, { ...failure, errorMessage: "402: Insufficient Balance" }];
  assert.equal(isStatusOnlyMessage(failure), true);
  const statuses = transcriptTurnStatuses(rows);
  assert.equal(statuses.size, 1);
  assert.deepEqual(statuses.get(2), { state: "failed", error: "401: API key expired\n\n402: Insufficient Balance" });
});

test("a successful fallback completes the turn and preserves its earlier diagnostic", () => {
  const answer = { role: "assistant", content: "New answer", stopReason: "stop" };
  const statuses = transcriptTurnStatuses([user, failure, answer]);
  assert.equal(statuses.size, 1);
  assert.deepEqual(statuses.get(2), { state: "complete", error: failure.errorMessage });
  assert.equal(isStatusOnlyMessage(answer), false);
});

test("status-only errors do not become duplicate assistant bubbles; real partial replies stay visible", () => {
  assert.equal(isStatusOnlyMessage({ ...failure, content: failure.errorMessage!, steps: [{ id: "error", kind: "text", content: failure.errorMessage! }] }), true);
  assert.equal(isStatusOnlyMessage({ ...failure, content: "Completed part of the work" }), false);
  assert.equal(isStatusOnlyMessage({ ...failure, attachments: [{ original: "voice.ogg", mediaType: "audio" }] }), false);
});

test("missing results remain unknown rather than inventing a failure or a running state", () => {
  assert.equal(transcriptTurnStatuses([user]).size, 0);
  assert.equal(transcriptTurnStatuses([user], true).get(0)?.state, "unknown");
  const statuses = transcriptTurnStatuses([user, failure, user], true);
  assert.equal(statuses.get(1)?.state, "failed");
  assert.equal(statuses.get(2)?.state, "unknown");
});

test("completion, cancellation and approval have distinct states", () => {
  for (const [reason, state] of [["stop", "complete"], ["aborted", "stopped"], ["waiting_for_approval", "waiting"]]) {
    const message = { role: "assistant", content: "", stopReason: reason };
    assert.equal(transcriptTurnStatuses([user, message]).get(1)?.state, state);
  }
});
