import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TurnOrchestrator } from "./turnOrchestrator.js";

test("a run awaiting recovery review is non-terminal and cleared only by Stop", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-recovery-review-"));
  const dbPath = join(directory, "runs.sqlite");
  try {
    const orchestrator = new TurnOrchestrator(undefined, dbPath);
    orchestrator.getRunStatus("init"); // create the runs schema lazily
    const db = new DatabaseSync(dbPath);
    try {
      const insert = db.prepare("INSERT INTO runs (id, session_id, actor_id, channel_id, status, started_at) VALUES (?,?,?,?,?,?)");
      const now = new Date().toISOString();
      insert.run("run-review", "session-a", "actor", "web", "running", now);
      insert.run("run-live", "session-a", "actor", "web", "running", now);
    } finally { db.close(); }

    assert.equal(orchestrator.markRunForRecoveryReview("run-review", "Unknown external operation."), true);
    assert.equal(orchestrator.getRunStatus("run-review"), "recovery_review");
    assert.equal(orchestrator.markRunForRecoveryReview("run-review", "again"), false, "a parked run is not re-parked");

    assert.equal(orchestrator.abortRunningTurnsForSession("session-a", "Stopped by user."), 2);
    assert.equal(orchestrator.getRunStatus("run-review"), "aborted");
    assert.equal(orchestrator.getRunStatus("run-live"), "aborted");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
