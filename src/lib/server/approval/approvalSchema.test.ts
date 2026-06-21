import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureApprovalsTable, migrateLegacyApprovalTables } from "$lib/server/approval/approvalSchema.js";

function tempDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "approvals-schema-"));
  return new DatabaseSync(join(dir, "settings.db"));
}

function seedLegacyTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE approval_requests (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, session_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, capability TEXT NOT NULL,
      risk_level TEXT NOT NULL, action_json TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL, requested_by_json TEXT NOT NULL, scope_options_json TEXT NOT NULL,
      selected_scope TEXT, action_fingerprint TEXT, created_at TEXT NOT NULL, resolved_at TEXT
    );
    CREATE TABLE approval_grants (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, capability TEXT NOT NULL, actor_id TEXT NOT NULL,
      workspace_id TEXT, session_id TEXT, run_id TEXT, action_fingerprint TEXT,
      expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT
    );
    INSERT INTO approval_requests VALUES
      ('req-1','run-1','sess-1','ws-1','actor-1','bash:git','high','{"type":"bash"}','need','pending','{"agentId":"a","depth":0}','["once"]',NULL,'fp-1','2026-06-20T00:00:00.000Z',NULL);
    INSERT INTO approval_grants VALUES
      ('hbw-git','persistent','bash:git','actor-1','ws-1','sess-1','run-1','fp-1',NULL,'2026-06-20T00:00:00.000Z',NULL);
  `);
}

test("migrateLegacyApprovalTables copies requests and grants into the unified table with a type discriminator", () => {
  const db = tempDb();
  seedLegacyTables(db);
  ensureApprovalsTable(db);
  migrateLegacyApprovalTables(db);

  const rows = db.prepare("SELECT id, type, capability, status, scope FROM approvals ORDER BY type").all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 2);
  const grant = rows.find((r) => r.type === "grant");
  const request = rows.find((r) => r.type === "request");
  assert.equal(grant?.id, "hbw-git");
  assert.equal(grant?.scope, "persistent");
  assert.equal(grant?.status, null);
  assert.equal(request?.id, "req-1");
  assert.equal(request?.status, "pending");
  assert.equal(request?.scope, null);
});

test("migrateLegacyApprovalTables is idempotent and safe when legacy tables are absent", () => {
  const db = tempDb();
  ensureApprovalsTable(db);
  migrateLegacyApprovalTables(db); // no legacy tables — must not throw
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n, 0);

  seedLegacyTables(db);
  migrateLegacyApprovalTables(db);
  migrateLegacyApprovalTables(db); // run twice
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n, 2);
});

test("ensureApprovalsTable is idempotent", () => {
  const db = tempDb();
  ensureApprovalsTable(db);
  ensureApprovalsTable(db);
  // table usable
  db.prepare("INSERT INTO approvals (id, type, capability, actor_id, created_at) VALUES ('x','grant','c','a','t')").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n, 1);
});
