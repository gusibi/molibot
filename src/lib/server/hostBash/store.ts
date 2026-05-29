import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import {
  coerceApprovalMode,
  createHostBashApprovalRecord,
  defaultHostBashPermissions,
  sanitizeHostBashId,
  sanitizeHostBashPendingAction,
  sanitizeHostBashPermissions
} from "$lib/server/hostBash/approval.js";
import type {
  ApprovedHostBashEntry,
  HostBashApprovalRecord,
  HostBashApprovalStatus,
  HostBashListFilters
} from "$lib/server/hostBash/types.js";

interface LegacyHostToolPermissions {
  envAllowlist?: unknown;
  filesystem?: unknown;
  network?: unknown;
}

interface LegacyHostToolPendingAction {
  kind?: unknown;
  originalCommand?: unknown;
  args?: unknown;
  stdin?: unknown;
  timeout?: unknown;
}

interface LegacyHostToolApproval {
  id?: unknown;
  toolId?: unknown;
  displayName?: unknown;
  command?: unknown;
  reason?: unknown;
  channel?: unknown;
  chatId?: unknown;
  scopeId?: unknown;
  requestedAt?: unknown;
  approvalMode?: unknown;
  status?: unknown;
  resolvedAt?: unknown;
  permissions?: LegacyHostToolPermissions;
  pendingAction?: LegacyHostToolPendingAction;
}

interface LegacyApprovedHostTool {
  toolId?: unknown;
  displayName?: unknown;
  command?: unknown;
  reason?: unknown;
  channel?: unknown;
  chatId?: unknown;
  scopeId?: unknown;
  approvedAt?: unknown;
  approvedFromRequestId?: unknown;
  permissions?: LegacyHostToolPermissions;
  enabled?: unknown;
}

interface LegacyHostToolSettings {
  pendingApprovals?: LegacyHostToolApproval[];
  approvalHistory?: LegacyHostToolApproval[];
  approvedTools?: LegacyApprovedHostTool[];
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeStatus(input: unknown): HostBashApprovalStatus {
  const value = String(input ?? "").trim();
  if (value === "approved" || value === "rejected" || value === "executed" || value === "failed") return value;
  return "pending";
}

function capabilityToToolId(capability: string): string {
  if (capability.startsWith("bash:")) return capability.slice(5);
  return capability;
}

function selectedScopeToApprovalMode(selectedScope: string | null, fallbackMode: string): any {
  if (selectedScope === "persistent") return "persistent";
  if (selectedScope === "session") return "session";
  if (selectedScope === "once") return "ephemeral";
  return coerceApprovalMode(fallbackMode);
}

function rowToApprovalRecord(row: Record<string, any>): HostBashApprovalRecord {
  const action = parseJson<any>(row.action_json, {});
  const toolId = action.toolName || capabilityToToolId(row.capability);

  return {
    id: row.id,
    toolId,
    displayName: action.displayName || toolId,
    command: action.command || "",
    reason: row.reason,
    channel: action.channel || "",
    chatId: action.chatId || "",
    scopeId: row.run_id,
    sessionId: row.session_id || undefined,
    approvalMode: selectedScopeToApprovalMode(row.selected_scope, action.approvalMode),
    status: normalizeStatus(row.status),
    permissions: action.permissions || defaultHostBashPermissions,
    pendingAction: action.pendingAction,
    requestedAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
    executedAt: action.executedAt || undefined,
    approvedBashId: row.selected_scope === "persistent" ? `hbw-${toolId}` : undefined,
    errorText: action.errorText || undefined
  };
}

function rowToWhitelistEntry(row: Record<string, any>): ApprovedHostBashEntry {
  const toolId = capabilityToToolId(row.capability);
  const metadata = parseJson<any>(row.action_fingerprint, {});
  return {
    id: row.id,
    toolId,
    displayName: metadata.displayName || toolId,
    command: metadata.command || "",
    reason: metadata.reason || "",
    channel: metadata.channel || "",
    chatId: metadata.chatId || "",
    scopeId: metadata.scopeId || "",
    permissions: metadata.permissions || defaultHostBashPermissions,
    approvedAt: row.created_at,
    approvedFromRecordId: row.run_id || "",
    enabled: row.revoked_at === null
  };
}

function toSqlJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class HostBashStore {
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

  hasAnyData(): boolean {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM approval_requests WHERE capability LIKE 'bash:%') AS record_count,
        (SELECT COUNT(*) FROM approval_grants WHERE capability LIKE 'bash:%') AS whitelist_count
    `).get() as Record<string, unknown> | undefined;
    return Number(row?.record_count ?? 0) > 0 || Number(row?.whitelist_count ?? 0) > 0;
  }

  migrateLegacySettings(input: LegacyHostToolSettings | null | undefined): void {
    if (!input || this.hasAnyData()) return;

    const pendingApprovals = Array.isArray(input.pendingApprovals) ? input.pendingApprovals : [];
    const approvalHistory = Array.isArray(input.approvalHistory) ? input.approvalHistory : [];
    const approvedTools = Array.isArray(input.approvedTools) ? input.approvedTools : [];
    if (pendingApprovals.length === 0 && approvalHistory.length === 0 && approvedTools.length === 0) return;

    const insertRecord = this.db.prepare(`
      INSERT OR IGNORE INTO approval_requests (
        id, run_id, session_id, workspace_id, actor_id, capability, risk_level,
        action_json, reason, status, requested_by_json, scope_options_json,
        selected_scope, action_fingerprint, created_at, resolved_at
      ) VALUES (
        @id, @run_id, @session_id, @workspace_id, @actor_id, @capability, @risk_level,
        @action_json, @reason, @status, @requested_by_json, @scope_options_json,
        @selected_scope, @action_fingerprint, @created_at, @resolved_at
      )
    `);
    const insertWhitelist = this.db.prepare(`
      INSERT OR IGNORE INTO approval_grants (
        id, scope, capability, actor_id, workspace_id, session_id, run_id,
        action_fingerprint, expires_at, created_at, revoked_at
      ) VALUES (
        @id, @scope, @capability, @actor_id, @workspace_id, @session_id, @run_id,
        @action_fingerprint, @expires_at, @created_at, @revoked_at
      )
    `);

    for (const row of [...approvalHistory, ...pendingApprovals]) {
      const command = String(row.command ?? "").trim();
      const toolId = sanitizeHostBashId(row.toolId ?? command);
      if (!toolId || !command) continue;

      const approvalMode = coerceApprovalMode(row.approvalMode);
      const action = {
        type: "bash",
        command,
        displayName: String(row.displayName ?? toolId).trim() || toolId,
        channel: String(row.channel ?? "").trim(),
        chatId: String(row.chatId ?? "").trim(),
        pendingAction: row.pendingAction ? {
          ...row.pendingAction,
          kind: String(row.pendingAction.kind ?? "").trim() === "run_approved_host_tool"
            ? "run_approved_host_bash"
            : row.pendingAction.kind
        } : null,
        permissions: sanitizeHostBashPermissions(row.permissions ?? defaultHostBashPermissions)
      };

      insertRecord.run({
        id: String(row.id ?? `legacy-bash-${toolId}-${Date.now().toString(36)}`),
        run_id: String(row.scopeId ?? "").trim(),
        session_id: "",
        workspace_id: "personal",
        actor_id: "agent-1",
        capability: `bash:${toolId}`,
        risk_level: "high",
        action_json: JSON.stringify(action),
        reason: String(row.reason ?? "").trim(),
        status: normalizeStatus(row.status),
        requested_by_json: JSON.stringify({ agentId: "agent-1", depth: 0 }),
        scope_options_json: JSON.stringify(["once", "session", "persistent"]),
        selected_scope: approvalMode === "persistent" ? "persistent" : approvalMode === "session" ? "session" : "once",
        action_fingerprint: null,
        created_at: String(row.requestedAt ?? new Date().toISOString()).trim() || new Date().toISOString(),
        resolved_at: String(row.resolvedAt ?? "").trim() || null
      });
    }

    for (const row of approvedTools) {
      const command = String(row.command ?? "").trim();
      const toolId = sanitizeHostBashId(row.toolId ?? command);
      if (!toolId || !command) continue;
      const approvedFromRecordId = String(row.approvedFromRequestId ?? `legacy-${toolId}`).trim() || `legacy-${toolId}`;
      const metadata = {
        displayName: String(row.displayName ?? toolId).trim() || toolId,
        command,
        reason: String(row.reason ?? "").trim(),
        channel: String(row.channel ?? "").trim(),
        chatId: String(row.chatId ?? "").trim(),
        scopeId: String(row.scopeId ?? "").trim(),
        permissions: sanitizeHostBashPermissions(row.permissions ?? defaultHostBashPermissions)
      };

      insertWhitelist.run({
        id: `hbw-${toolId}`,
        scope: "persistent",
        capability: `bash:${toolId}`,
        actor_id: "agent-1",
        workspace_id: "personal",
        session_id: null,
        run_id: approvedFromRecordId,
        action_fingerprint: JSON.stringify(metadata),
        expires_at: null,
        created_at: String(row.approvedAt ?? new Date().toISOString()).trim() || new Date().toISOString(),
        revoked_at: row.enabled === false ? new Date().toISOString() : null
      });
    }
  }

  requestApproval(input: {
    toolId?: unknown;
    displayName?: unknown;
    command: unknown;
    reason: unknown;
    approvalMode?: unknown;
    permissions?: unknown;
    pendingAction?: unknown;
    channel: unknown;
    chatId: unknown;
    scopeId: unknown;
    sessionId?: unknown;
  }): {
    kind: "created" | "existing-pending" | "existing-approved";
    approval?: HostBashApprovalRecord;
    approved?: ApprovedHostBashEntry;
  } {
    const record = createHostBashApprovalRecord(input);

    if (record.approvalMode === "persistent") {
      const existingApproved = this.getApprovedEntry(record.toolId);
      if (existingApproved?.enabled) {
        return { kind: "existing-approved", approved: existingApproved };
      }
    }

    const pendingForScope = this.listPending(record.scopeId);
    const existingPending = pendingForScope.find((item) =>
      record.approvalMode === "persistent"
        ? item.toolId === record.toolId && item.approvalMode === "persistent"
        : item.approvalMode === "ephemeral" && item.pendingAction?.originalCommand === record.pendingAction?.originalCommand
    );
    if (existingPending) {
      return { kind: "existing-pending", approval: existingPending };
    }

    const action = {
      type: "bash",
      command: record.command,
      displayName: record.displayName,
      channel: record.channel,
      chatId: record.chatId,
      pendingAction: record.pendingAction,
      permissions: record.permissions,
      approvalMode: record.approvalMode
    };

    this.db.prepare(`
      INSERT INTO approval_requests (
        id, run_id, session_id, workspace_id, actor_id, capability, risk_level,
        action_json, reason, status, requested_by_json, scope_options_json,
        selected_scope, action_fingerprint, created_at, resolved_at
      ) VALUES (
        @id, @run_id, @session_id, @workspace_id, @actor_id, @capability, @risk_level,
        @action_json, @reason, @status, @requested_by_json, @scope_options_json,
        NULL, NULL, @created_at, NULL
      )
    `).run({
      id: record.id,
      run_id: record.scopeId,
      session_id: record.sessionId ?? "",
      workspace_id: "personal",
      actor_id: "agent-1",
      capability: `bash:${record.toolId}`,
      risk_level: "high",
      action_json: JSON.stringify(action),
      reason: record.reason,
      status: record.status,
      requested_by_json: JSON.stringify({ agentId: "agent-1", depth: 0 }),
      scope_options_json: JSON.stringify(["once", "session", "persistent"]),
      created_at: record.requestedAt
    });

    return { kind: "created", approval: record };
  }

  getPendingApproval(scopeId: string, approvalId?: string): HostBashApprovalRecord | null {
    const pending = this.listPending(scopeId);
    if (approvalId) return pending.find((item) => item.id === approvalId) ?? null;
    return pending.length === 1 ? pending[0] : null;
  }

  approve(scopeId: string, approvalId?: string, options?: { persistWhitelist?: boolean }): {
    record: HostBashApprovalRecord;
    approved?: ApprovedHostBashEntry;
  } | null {
    const record = this.getPendingApproval(scopeId, approvalId);
    if (!record) return null;

    const persistWhitelist = options?.persistWhitelist ?? true;
    const now = new Date().toISOString();
    let approved: ApprovedHostBashEntry | undefined;

    if (record.approvalMode === "persistent" && persistWhitelist) {
      const whitelistId = `hbw-${record.toolId}`;
      const metadata = {
        displayName: record.displayName,
        command: record.command,
        reason: record.reason,
        channel: record.channel,
        chatId: record.chatId,
        scopeId: record.scopeId,
        permissions: record.permissions
      };

      this.db.prepare(`
        INSERT INTO approval_grants (
          id, scope, capability, actor_id, workspace_id, session_id, run_id,
          action_fingerprint, expires_at, created_at, revoked_at
        ) VALUES (
          @id, 'persistent', @capability, 'agent-1', 'personal', NULL, @run_id,
          @action_fingerprint, NULL, @created_at, NULL
        )
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          capability = excluded.capability,
          run_id = excluded.run_id,
          action_fingerprint = excluded.action_fingerprint,
          created_at = excluded.created_at,
          revoked_at = NULL
      `).run({
        id: whitelistId,
        capability: `bash:${record.toolId}`,
        run_id: record.id,
        action_fingerprint: JSON.stringify(metadata),
        created_at: now
      });
      approved = this.getApprovedEntry(record.toolId) ?? undefined;
    }

    const row = this.db.prepare("SELECT action_json FROM approval_requests WHERE id = ?").get(record.id) as { action_json: string } | undefined;
    const action = row ? parseJson<any>(row.action_json, {}) : {};

    this.db.prepare(`
      UPDATE approval_requests
      SET status = 'approved',
          resolved_at = @resolved_at,
          selected_scope = @selected_scope,
          action_json = @action_json
      WHERE id = @id
    `).run({
      id: record.id,
      resolved_at: now,
      selected_scope: record.approvalMode === "persistent" ? "persistent" : record.approvalMode === "session" ? "session" : "once",
      action_json: JSON.stringify(action)
    });

    return { record: this.getApprovalRecord(record.id) ?? { ...record, status: "approved", resolvedAt: now }, approved };
  }

  reject(scopeId: string, approvalId?: string): HostBashApprovalRecord | null {
    const record = this.getPendingApproval(scopeId, approvalId);
    if (!record) return null;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE approval_requests
      SET status = 'rejected',
          resolved_at = @resolved_at
      WHERE id = @id
    `).run({ id: record.id, resolved_at: now });
    return this.getApprovalRecord(record.id) ?? { ...record, status: "rejected", resolvedAt: now };
  }

  markExecution(recordId: string, status: "executed" | "failed", errorText?: string): void {
    const row = this.db.prepare("SELECT action_json FROM approval_requests WHERE id = ?").get(recordId) as { action_json: string } | undefined;
    if (!row) return;
    const action = parseJson<any>(row.action_json, {});
    action.executedAt = new Date().toISOString();
    action.errorText = errorText ? String(errorText).slice(0, 4000) : null;

    this.db.prepare(`
      UPDATE approval_requests
      SET status = @status,
          action_json = @action_json
      WHERE id = @id
    `).run({
      id: recordId,
      status,
      action_json: JSON.stringify(action)
    });
  }

  getApprovalRecord(recordId: string): HostBashApprovalRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM approval_requests WHERE id = ? LIMIT 1
    `).get(recordId) as Record<string, unknown> | undefined;
    return row ? rowToApprovalRecord(row) : null;
  }

  getApprovedEntry(toolId: string): ApprovedHostBashEntry | null {
    const normalizedId = sanitizeHostBashId(toolId);
    if (!normalizedId) return null;
    const row = this.db.prepare(`
      SELECT * FROM approval_grants WHERE id = ? LIMIT 1
    `).get(`hbw-${normalizedId}`) as Record<string, unknown> | undefined;
    return row ? rowToWhitelistEntry(row) : null;
  }

  listPending(scopeId?: string): HostBashApprovalRecord[] {
    const stmt = scopeId
      ? this.db.prepare(`
          SELECT * FROM approval_requests
          WHERE status = 'pending' AND run_id = ? AND capability LIKE 'bash:%'
          ORDER BY created_at DESC
        `)
      : this.db.prepare(`
          SELECT * FROM approval_requests
          WHERE status = 'pending' AND capability LIKE 'bash:%'
          ORDER BY created_at DESC
        `);
    const rows = (scopeId ? stmt.all(scopeId) : stmt.all()) as Array<Record<string, unknown>>;
    return rows.map(rowToApprovalRecord);
  }

  listWhitelist(): ApprovedHostBashEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM approval_grants
      WHERE scope = 'persistent' AND capability LIKE 'bash:%'
      ORDER BY revoked_at ASC, created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(rowToWhitelistEntry);
  }

  listHistory(filters?: HostBashListFilters): HostBashApprovalRecord[] {
    const query = String(filters?.query ?? "").trim().toLowerCase();
    const status = filters?.status && filters.status !== "all" ? filters.status : null;
    const approvalMode = filters?.approvalMode && filters.approvalMode !== "all" ? filters.approvalMode : null;

    const clauses = ["status != 'pending'", "capability LIKE 'bash:%'"];
    const params: Array<string> = [];
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    if (approvalMode) {
      const scopeVal = approvalMode === "persistent" ? "persistent" : approvalMode === "session" ? "session" : "once";
      clauses.push("selected_scope = ?");
      params.push(scopeVal);
    }

    const rows = this.db.prepare(`
      SELECT * FROM approval_requests
      WHERE ${clauses.join(" AND ")}
      ORDER BY COALESCE(resolved_at, created_at) DESC
    `).all(...params) as Array<Record<string, unknown>>;

    const items = rows.map(rowToApprovalRecord);
    if (!query) return items;
    return items.filter((item) =>
      [
        item.toolId,
        item.displayName,
        item.command,
        item.reason,
        item.channel,
        item.chatId,
        item.scopeId,
        item.errorText ?? ""
      ].some((value) => value.toLowerCase().includes(query))
    );
  }

  setWhitelistEnabled(id: string, enabled: boolean): ApprovedHostBashEntry | null {
    if (enabled) {
      this.db.prepare(`
        UPDATE approval_grants SET revoked_at = NULL WHERE id = ?
      `).run(id);
    } else {
      this.db.prepare(`
        UPDATE approval_grants SET revoked_at = ? WHERE id = ?
      `).run(new Date().toISOString(), id);
    }
    const row = this.db.prepare(`
      SELECT * FROM approval_grants WHERE id = ? LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;
    return row ? rowToWhitelistEntry(row) : null;
  }

  deleteWhitelistEntry(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM approval_grants WHERE id = ?
    `).run(id);
    return Number(result.changes ?? 0) > 0;
  }

  deleteHistoryRecord(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM approval_requests WHERE id = ? AND status != 'pending'
    `).run(id);
    return Number(result.changes ?? 0) > 0;
  }
}

let singleton: HostBashStore | null = null;

export function getHostBashStore(): HostBashStore {
  if (!singleton) singleton = new HostBashStore();
  return singleton;
}
