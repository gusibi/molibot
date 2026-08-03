import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import {
  probeRuntime,
  recordRuntimeInitFailure,
  recordRuntimeReady,
  redactHomePath,
  resetRuntimeHealth,
  runtimeHealthSnapshot
} from "./runtimeHealth.js";

test("a ready runtime reports ready with no error and a reset failure count", () => {
  resetRuntimeHealth();
  recordRuntimeInitFailure(new Error("boom"));
  recordRuntimeReady();
  const snapshot = runtimeHealthSnapshot();
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.consecutiveFailures, 0);
  assert.notEqual(snapshot.lastReadyAt, null);
});

test("failures accumulate and expose a redacted message", () => {
  resetRuntimeHealth();
  const home = os.homedir();
  recordRuntimeInitFailure(new Error(`ENOENT: ${path.join(home, ".molibot", "miniapps")}`));
  recordRuntimeInitFailure(new Error("second"));
  const snapshot = runtimeHealthSnapshot();
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.consecutiveFailures, 2);
  assert.equal(snapshot.error, "second");
  assert.notEqual(snapshot.lastFailureAt, null);
});

test("redactHomePath strips the host home directory", () => {
  const home = os.homedir();
  const redacted = redactHomePath(`cannot write ${path.join(home, "secret")}/x`);
  assert.equal(redacted.includes(home), false);
  assert.equal(redacted.includes("~/secret"), true);
});

test("probeRuntime reports the initializer outcome without throwing", () => {
  resetRuntimeHealth();
  const failing = probeRuntime(() => {
    throw new Error("init failed");
  });
  assert.equal(failing.ready, false);
  assert.equal(failing.error, "init failed");

  const ok = probeRuntime(() => "runtime");
  assert.equal(ok.ready, true);
  assert.equal(ok.error, null);
  assert.equal(ok.consecutiveFailures, 0);
});
