import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ServiceLeaseConflictError,
  acquireServiceLease,
  readServiceState,
  resolveDataDir,
  writeServiceState
} from "./service-lease.mjs";

function withTempDataDir(run) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "molibot-service-lease-"));
  try {
    return run(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("resolveDataDir expands a portable home-relative path", () => {
  assert.equal(resolveDataDir({ DATA_DIR: "~/.molibot-test" }, "/tmp/home"), "/tmp/home/.molibot-test");
});

test("an active owner prevents a second writer", () =>
  withTempDataDir((dataDir) => {
    const first = acquireServiceLease({ dataDir, pid: 101, ownerId: "first" });
    assert.throws(
      () => acquireServiceLease({ dataDir, pid: 202, ownerId: "second", processRunning: () => true }),
      (error) => error instanceof ServiceLeaseConflictError && error.owner?.ownerId === "first"
    );
    assert.equal(first.release(), true);
  }));

test("a stale lease is reclaimed without deleting the new owner", () =>
  withTempDataDir((dataDir) => {
    acquireServiceLease({ dataDir, pid: 101, ownerId: "stale" });
    const current = acquireServiceLease({
      dataDir,
      pid: 202,
      ownerId: "current",
      processRunning: () => false
    });
    assert.equal(current.release(), true);
  }));

test("runtime state is private and removed only by its owner", () =>
  withTempDataDir((dataDir) => {
    const lease = acquireServiceLease({ dataDir, pid: 303, ownerId: "owner" });
    writeServiceState(lease, { status: "ready", endpoint: "http://127.0.0.1:4100" });
    assert.equal(readServiceState(dataDir)?.endpoint, "http://127.0.0.1:4100");
    assert.equal(lease.release(), true);
    assert.equal(readServiceState(dataDir), null);
  }));
