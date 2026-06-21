import type { DatabaseSync } from "node:sqlite";

/**
 * Unified approval persistence table. Replaces the two legacy tables
 * `approval_requests` (transient request lifecycle) and `approval_grants`
 * (durable authorizations); a `type` discriminator (`'request' | 'grant'`)
 * distinguishes the two. Both SqliteApprovalStore (broker) and HostBashStore
 * read/write this single table. Bash-domain rows are still tagged by
 * `capability LIKE 'bash:%'`.
 *
 * Columns are the union of both legacy schemas; request-only and grant-only
 * columns are nullable. Legacy NOT NULL constraints are relaxed accordingly.
 */
export const APPROVALS_TABLE = "approvals";

export type ApprovalRowType = "request" | "grant";

export function ensureApprovalsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      capability TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      workspace_id TEXT,
      session_id TEXT,
      run_id TEXT,
      action_fingerprint TEXT,
      created_at TEXT NOT NULL,
      -- request-only
      risk_level TEXT,
      action_json TEXT,
      reason TEXT,
      status TEXT,
      requested_by_json TEXT,
      scope_options_json TEXT,
      selected_scope TEXT,
      resolved_at TEXT,
      -- grant-only
      scope TEXT,
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_type_status ON approvals(type, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id, type, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id, type, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_capability_actor ON approvals(capability, actor_id, type);
    CREATE INDEX IF NOT EXISTS idx_approvals_workspace_cap ON approvals(workspace_id, capability, type);
    CREATE INDEX IF NOT EXISTS idx_approvals_created ON approvals(created_at);
  `);
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(name) as { name?: string } | undefined;
  return Boolean(row?.name);
}

/**
 * One-time, idempotent copy of any legacy `approval_requests` / `approval_grants`
 * rows into the unified table. Uses INSERT OR IGNORE keyed on the primary key so
 * repeated runs are safe. The legacy tables are left intact for reversibility.
 */
export function migrateLegacyApprovalTables(db: DatabaseSync): void {
  ensureApprovalsTable(db);

  if (tableExists(db, "approval_requests")) {
    db.exec(`
      INSERT OR IGNORE INTO approvals (
        id, type, capability, actor_id, workspace_id, session_id, run_id,
        action_fingerprint, created_at, risk_level, action_json, reason, status,
        requested_by_json, scope_options_json, selected_scope, resolved_at
      )
      SELECT
        id, 'request', capability, actor_id, workspace_id, session_id, run_id,
        action_fingerprint, created_at, risk_level, action_json, reason, status,
        requested_by_json, scope_options_json, selected_scope, resolved_at
      FROM approval_requests;
    `);
  }

  if (tableExists(db, "approval_grants")) {
    db.exec(`
      INSERT OR IGNORE INTO approvals (
        id, type, capability, actor_id, workspace_id, session_id, run_id,
        action_fingerprint, created_at, scope, expires_at, revoked_at
      )
      SELECT
        id, 'grant', capability, actor_id, workspace_id, session_id, run_id,
        action_fingerprint, created_at, scope, expires_at, revoked_at
      FROM approval_grants;
    `);
  }
}
