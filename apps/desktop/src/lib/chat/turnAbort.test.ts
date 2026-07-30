import assert from "node:assert/strict";
import test from "node:test";
import { isAbortCause } from "./turnAbort";

test("a user Stop is recognized across every transport's cancellation shape", () => {
  // Tauri's HTTP plugin (the packaged Desktop app) — issue #24's red banner.
  assert.equal(isAbortCause(new Error("Request cancelled")), true);
  assert.equal(isAbortCause(new Error("Request canceled")), true);
  // Browser/undici fetch.
  assert.equal(isAbortCause(new DOMException("The user aborted a request.", "AbortError")), true);
  assert.equal(isAbortCause(new Error("The operation was aborted.")), true);
  // Our own abort always wins, whatever the rejection looks like.
  const controller = new AbortController();
  controller.abort();
  assert.equal(isAbortCause(new Error("stream closed"), controller.signal), true);
});

test("real turn failures are never silenced as cancellations", () => {
  assert.equal(isAbortCause(new Error("Already working. Please wait for current response to finish.")), false);
  assert.equal(isAbortCause(new Error("Stream failed (500)")), false);
  // Mentions an abort but is a genuine runtime failure the user must see.
  assert.equal(isAbortCause(new Error("tool run aborted after 3 retries")), false);
  assert.equal(isAbortCause(new Error("Request cancelled by the upstream provider")), false);
  const live = new AbortController();
  assert.equal(isAbortCause(new Error("Stream failed (502)"), live.signal), false);
});
