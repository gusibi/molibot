import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { ApprovalBrokerStore } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalGrant, ApprovalRequest, ApprovalScope, ApprovalStatus } from "$lib/server/approval/approvalTypes.js";

interface ApprovalRequestRow {
  id: string;
  run_id: string;
  session_id: string;
  workspace_id: string;
  actor_id: string;
  capability: string;
  risk_level: string;
  action_json: string;
  reason: string;
  status: string;
  requested_by_json: string;
  scope_options_json: string;
  selected_scope: string | null;
  action_fingerprint: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface ApprovalGrantRow {
  id: string;
  scope: string;
  capability: string;
  actor_id: string;
  workspace_id: string | null;
  session_id: string | null;
  run_id: string | null;
  action_fingerprint: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function approvalStatus(value: string): ApprovalStatus {
  if (value === "approved" || value === "rejected" || value === "expired") return value;
  return "pending";
}

function approvalScope(value: string): ApprovalScope {
  if (value === "turn" || value === "session" || value === "workspace" || value === "persistent") return value;
  return "once";
}

function rowToRequest(row: ApprovalRequestRow): ApprovalRequest {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    capability: row.capability,
    riskLevel: row.risk_level === "medium" || row.risk_level === "high" || row.risk_level === "critical"
      ? row.risk_level
      : "low",
    action: parseJson(row.action_json, { type: "mcp_tool" }),
    reason: row.reason,
    status: approvalStatus(row.status),
    requestedBy: parseJson(row.requested_by_json, { agentId: row.actor_id, depth: 0 }),
    scopeOptions: parseJson(row.scope_options_json, ["once"]).map(approvalScope),
    selectedScope: row.selected_scope ? approvalScope(row.selected_scope) : undefined,
    actionFingerprint: row.action_fingerprint || undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined
  };
}

function rowToGrant(row: ApprovalGrantRow): ApprovalGrant {
  return {
    id: row.id,
    scope: approvalScope(row.scope),
    capability: row.capability,
    actorId: row.actor_id,
    workspaceId: row.workspace_id || undefined,
    sessionId: row.session_id || undefined,
    runId: row.run_id || undefined,
    actionFingerprint: row.action_fingerprint || undefined,
    expiresAt: row.expires_at || undefined,
    createdAt: row.created_at,
    revokedAt: row.revoked_at || undefined
  };
}

export class SqliteApprovalStore implements ApprovalBrokerStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = storagePaths.settingsDbFile) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        action_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by_json TEXT NOT NULL,
        scope_options_json TEXT NOT NULL,
        selected_scope TEXT,
        action_fingerprint TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approval_requests_run_status ON approval_requests(run_id, status);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_session_status ON approval_requests(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_workspace_cap_status ON approval_requests(workspace_id, capability, status);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_created ON approval_requests(created_at);

      CREATE TABLE IF NOT EXISTS approval_grants (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        capability TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        workspace_id TEXT,
        session_id TEXT,
        run_id TEXT,
        action_fingerprint TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approval_grants_capability_actor ON approval_grants(capability, actor_id);
      CREATE INDEX IF NOT EXISTS idx_approval_grants_workspace ON approval_grants(workspace_id, capability);
      CREATE INDEX IF NOT EXISTS idx_approval_grants_session ON approval_grants(session_id, capability);
      CREATE INDEX IF NOT EXISTS idx_approval_grants_run ON approval_grants(run_id, capability);
    `);
  }

  listActiveGrants(): ApprovalGrant[] {
    const rows = this.db.prepare("SELECT * FROM approval_grants WHERE revoked_at IS NULL").all() as unknown as ApprovalGrantRow[];
    return rows.map(rowToGrant);
  }

  saveGrant(grant: ApprovalGrant): void {
    this.db.prepare(`
      INSERT INTO approval_grants (
        id, scope, capability, actor_id, workspace_id, session_id, run_id,
        action_fingerprint, expires_at, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope = excluded.scope,
        capability = excluded.capability,
        actor_id = excluded.actor_id,
        workspace_id = excluded.workspace_id,
        session_id = excluded.session_id,
        run_id = excluded.run_id,
        action_fingerprint = excluded.action_fingerprint,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at,
        revoked_at = excluded.revoked_at
    `).run(
      grant.id,
      grant.scope,
      grant.capability,
      grant.actorId,
      grant.workspaceId ?? null,
      grant.sessionId ?? null,
      grant.runId ?? null,
      grant.actionFingerprint ?? null,
      grant.expiresAt ?? null,
      grant.createdAt,
      grant.revokedAt ?? null
    );
  }

  saveRequest(request: ApprovalRequest): void {
    this.writeRequest(request);
  }

  updateRequest(request: ApprovalRequest): void {
    this.writeRequest(request);
  }

  listPendingRequests(): ApprovalRequest[] {
    const rows = this.db.prepare("SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at ASC").all("pending") as unknown as ApprovalRequestRow[];
    return rows.map(rowToRequest);
  }

  getRequest(id: string): ApprovalRequest | null {
    const row = this.db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as unknown as ApprovalRequestRow | undefined;
    return row ? rowToRequest(row) : null;
  }

  close(): void {
    this.db.close();
  }

  private writeRequest(request: ApprovalRequest): void {
    this.db.prepare(`
      INSERT INTO approval_requests (
        id, run_id, session_id, workspace_id, actor_id, capability, risk_level,
        action_json, reason, status, requested_by_json, scope_options_json,
        selected_scope, action_fingerprint, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        run_id = excluded.run_id,
        session_id = excluded.session_id,
        workspace_id = excluded.workspace_id,
        actor_id = excluded.actor_id,
        capability = excluded.capability,
        risk_level = excluded.risk_level,
        action_json = excluded.action_json,
        reason = excluded.reason,
        status = excluded.status,
        requested_by_json = excluded.requested_by_json,
        scope_options_json = excluded.scope_options_json,
        selected_scope = excluded.selected_scope,
        action_fingerprint = excluded.action_fingerprint,
        created_at = excluded.created_at,
        resolved_at = excluded.resolved_at
    `).run(
      request.id,
      request.runId,
      request.sessionId,
      request.workspaceId,
      request.actorId,
      request.capability,
      request.riskLevel,
      JSON.stringify(request.action),
      request.reason,
      request.status,
      JSON.stringify(request.requestedBy),
      JSON.stringify(request.scopeOptions),
      request.selectedScope ?? null,
      request.actionFingerprint ?? null,
      request.createdAt,
      request.resolvedAt ?? null
    );
  }
}
