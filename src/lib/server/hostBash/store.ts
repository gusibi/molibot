import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import { ensureApprovalsTable, migrateLegacyApprovalTables } from "$lib/server/approval/approvalSchema.js";
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
  HostBashApprovalScope,
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
  if (value === "approved" || value === "executing" || value === "rejected" || value === "executed" || value === "failed" || value === "expired") return value;
  return "pending";
}

// Pending approvals older than this are auto-expired so stale cards stop accepting clicks.
const PENDING_APPROVAL_TTL_MS = 60 * 60 * 1000;

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
    classification: action.classification || undefined,
    requestedAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
    executedAt: action.executedAt || undefined,
    approvedBashId: row.selected_scope === "persistent" ? `hbw-${toolId}` : undefined,
    errorText: action.errorText || undefined
  };
}

function rowToWhitelistEntry(row: Record<string, any>): ApprovedHostBashEntry {
  const toolId = capabilityToToolId(row.capability);
  const parsedMetadata = parseJson<unknown>(row.action_fingerprint, {});
  const metadata = parsedMetadata && typeof parsedMetadata === "object" && !Array.isArray(parsedMetadata)
    ? parsedMetadata as Record<string, any>
    : {};
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
    ensureSqliteParentDir(dbPath);
    this.db = new DatabaseSync(dbPath);
    ensureApprovalsTable(this.db);
    migrateLegacyApprovalTables(this.db);
  }

  hasAnyData(): boolean {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM approvals WHERE type = 'request' AND capability LIKE 'bash:%') AS record_count,
        (SELECT COUNT(*) FROM approvals WHERE type = 'grant' AND capability LIKE 'bash:%') AS whitelist_count
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
      INSERT OR IGNORE INTO approvals (
        id, type, run_id, session_id, workspace_id, actor_id, capability, risk_level,
        action_json, reason, status, requested_by_json, scope_options_json,
        selected_scope, action_fingerprint, created_at, resolved_at
      ) VALUES (
        @id, 'request', @run_id, @session_id, @workspace_id, @actor_id, @capability, @risk_level,
        @action_json, @reason, @status, @requested_by_json, @scope_options_json,
        @selected_scope, @action_fingerprint, @created_at, @resolved_at
      )
    `);
    const insertWhitelist = this.db.prepare(`
      INSERT OR IGNORE INTO approvals (
        id, type, scope, capability, actor_id, workspace_id, session_id, run_id,
        action_fingerprint, expires_at, created_at, revoked_at
      ) VALUES (
        @id, 'grant', @scope, @capability, @actor_id, @workspace_id, @session_id, @run_id,
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
    classification?: unknown;
    channel: unknown;
    chatId: unknown;
    scopeId: unknown;
    sessionId?: unknown;
    requestedByDepth?: number;
  }): {
    kind: "created" | "existing-pending" | "existing-approved";
    approval?: HostBashApprovalRecord;
    approved?: ApprovedHostBashEntry;
  } {
    const record = createHostBashApprovalRecord(input);
    this.expireStalePending();

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

    // Retire older pending prompts for the same capability in this scope so
    // retried/adjusted commands don't pile up multiple live approval cards.
    this.db.prepare(`
      UPDATE approvals
      SET status = 'expired', resolved_at = @resolved_at
      WHERE type = 'request' AND status = 'pending' AND run_id = @run_id AND capability = @capability
    `).run({
      resolved_at: new Date().toISOString(),
      run_id: record.scopeId,
      capability: `bash:${record.toolId}`
    });

    const action = {
      type: "bash",
      command: record.command,
      displayName: record.displayName,
      channel: record.channel,
      chatId: record.chatId,
      pendingAction: record.pendingAction,
      classification: record.classification,
      permissions: record.permissions,
      approvalMode: record.approvalMode
    };

    this.db.prepare(`
      INSERT INTO approvals (
        id, type, run_id, session_id, workspace_id, actor_id, capability, risk_level,
        action_json, reason, status, requested_by_json, scope_options_json,
        selected_scope, action_fingerprint, created_at, resolved_at
      ) VALUES (
        @id, 'request', @run_id, @session_id, @workspace_id, @actor_id, @capability, @risk_level,
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
      requested_by_json: JSON.stringify({ agentId: "agent-1", depth: input.requestedByDepth ?? 0 }),
      scope_options_json: JSON.stringify(["once", "session", "persistent"]),
      created_at: record.requestedAt
    });

    return { kind: "created", approval: record };
  }

  getPendingApproval(scopeId: string, approvalId?: string, sessionId?: string): HostBashApprovalRecord | null {
    if (approvalId) {
      const record = this.getApprovalRecord(approvalId);
      if (record && record.status === "pending") {
        return record;
      }
      return null;
    }
    const pending = this.listPending(scopeId, sessionId);
    return pending.length === 1 ? pending[0] : null;
  }

  approve(scopeId: string, approvalId?: string, options?: {
    persistWhitelist?: boolean;
    sessionId?: string;
    scope?: HostBashApprovalScope;
  }): {
    record: HostBashApprovalRecord;
    approved?: ApprovedHostBashEntry;
    approvedEntries?: ApprovedHostBashEntry[];
  } | null {
    const record = this.getPendingApproval(scopeId, approvalId, options?.sessionId);
    if (!record) return null;

    const selectedScope: HostBashApprovalScope = options?.scope
      ?? (options?.persistWhitelist === false
        ? "session"
        : record.approvalMode === "persistent"
          ? "persistent"
          : record.approvalMode === "session" ? "session" : "once");
    const now = new Date().toISOString();
    const approvedEntries: ApprovedHostBashEntry[] = [];

    if (selectedScope === "persistent") {
      // Grant every distinct capability in the command (compound commands get
      // all their tools whitelisted in one approval). Fall back to the record's
      // own toolId when no reusable capability classification is available.
      const capabilities = record.classification && record.classification.kind !== "one-time-script"
        ? [...new Map(record.classification.capabilities.map((item) => [
            sanitizeHostBashId(item.toolId),
            { toolId: sanitizeHostBashId(item.toolId), command: item.executable }
          ])).values()]
        : record.classification?.kind === "one-time-script"
          ? []
          : [{ toolId: record.toolId, command: record.command }];

      const insertGrant = this.db.prepare(`
        INSERT INTO approvals (
          id, type, scope, capability, actor_id, workspace_id, session_id, run_id,
          action_fingerprint, expires_at, created_at, revoked_at
        ) VALUES (
          @id, 'grant', 'persistent', @capability, 'agent-1', 'personal', NULL, @run_id,
          @action_fingerprint, NULL, @created_at, NULL
        )
        ON CONFLICT(id) DO UPDATE SET
          type = 'grant',
          scope = excluded.scope,
          capability = excluded.capability,
          run_id = excluded.run_id,
          action_fingerprint = excluded.action_fingerprint,
          created_at = excluded.created_at,
          revoked_at = NULL
      `);

      for (const capability of capabilities) {
        if (!capability.toolId) continue;
        const metadata = {
          displayName: capabilities.length === 1 ? record.displayName : capability.toolId,
          command: capability.command,
          reason: record.reason,
          channel: record.channel,
          chatId: record.chatId,
          scopeId: record.scopeId,
          permissions: record.permissions
        };
        insertGrant.run({
          id: `hbw-${capability.toolId}`,
          capability: `bash:${capability.toolId}`,
          run_id: record.id,
          action_fingerprint: JSON.stringify(metadata),
          created_at: now
        });
        const entry = this.getApprovedEntry(capability.toolId);
        if (entry) approvedEntries.push(entry);
      }
    }

    const row = this.db.prepare("SELECT action_json FROM approvals WHERE type = 'request' AND id = ?").get(record.id) as { action_json: string } | undefined;
    const action = row ? parseJson<any>(row.action_json, {}) : {};

    this.db.prepare(`
      UPDATE approvals
      SET status = 'approved',
          resolved_at = @resolved_at,
          selected_scope = @selected_scope,
          action_json = @action_json
      WHERE type = 'request' AND id = @id
    `).run({
      id: record.id,
      resolved_at: now,
      selected_scope: selectedScope === "once" ? "once" : selectedScope,
      action_json: JSON.stringify(action)
    });

    return {
      record: this.getApprovalRecord(record.id) ?? { ...record, status: "approved", resolvedAt: now },
      approved: approvedEntries[0],
      approvedEntries: approvedEntries.length > 0 ? approvedEntries : undefined
    };
  }

  reject(scopeId: string, approvalId?: string, sessionId?: string): HostBashApprovalRecord | null {
    const record = this.getPendingApproval(scopeId, approvalId, sessionId);
    if (!record) return null;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE approvals
      SET status = 'rejected',
          resolved_at = @resolved_at
      WHERE type = 'request' AND id = @id
    `).run({ id: record.id, resolved_at: now });
    return this.getApprovalRecord(record.id) ?? { ...record, status: "rejected", resolvedAt: now };
  }

  markExecution(recordId: string, status: "executed" | "failed", errorText?: string): void {
    const row = this.db.prepare("SELECT action_json FROM approvals WHERE type = 'request' AND id = ?").get(recordId) as { action_json: string } | undefined;
    if (!row) return;
    const action = parseJson<any>(row.action_json, {});
    action.executedAt = new Date().toISOString();
    action.errorText = errorText ? String(errorText).slice(0, 4000) : null;

    this.db.prepare(`
      UPDATE approvals
      SET status = @status,
          action_json = @action_json
      WHERE type = 'request' AND id = @id
    `).run({
      id: recordId,
      status,
      action_json: JSON.stringify(action)
    });
  }

  // Atomically claims the right to execute an approved record. Both the in-run
  // blocking bash waiter and the channel approval handler may try to execute;
  // only the caller that wins this compare-and-set runs the command.
  claimExecution(recordId: string): boolean {
    const result = this.db.prepare(`
      UPDATE approvals
      SET status = 'executing'
      WHERE type = 'request' AND id = ? AND status = 'approved'
    `).run(recordId);
    return Number(result.changes ?? 0) > 0;
  }

  getApprovalRecord(recordId: string): HostBashApprovalRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM approvals WHERE type = 'request' AND id = ? LIMIT 1
    `).get(recordId) as Record<string, unknown> | undefined;
    return row ? rowToApprovalRecord(row) : null;
  }

  getApprovedEntry(toolId: string): ApprovedHostBashEntry | null {
    const normalizedId = sanitizeHostBashId(toolId);
    if (!normalizedId) return null;
    const row = this.db.prepare(`
      SELECT * FROM approvals WHERE type = 'grant' AND id = ? LIMIT 1
    `).get(`hbw-${normalizedId}`) as Record<string, unknown> | undefined;
    return row ? rowToWhitelistEntry(row) : null;
  }

  private expireStalePending(): void {
    const cutoff = new Date(Date.now() - PENDING_APPROVAL_TTL_MS).toISOString();
    this.db.prepare(`
      UPDATE approvals
      SET status = 'expired', resolved_at = @resolved_at
      WHERE type = 'request' AND status = 'pending' AND capability LIKE 'bash:%' AND created_at < @cutoff
    `).run({ resolved_at: new Date().toISOString(), cutoff });
  }

  listPending(scopeId?: string, sessionId?: string): HostBashApprovalRecord[] {
    this.expireStalePending();
    if (scopeId) {
      const stmt = sessionId
        ? this.db.prepare(`
            SELECT * FROM approvals
            WHERE type = 'request' AND status = 'pending' AND (run_id = ? OR session_id = ?) AND capability LIKE 'bash:%'
            ORDER BY created_at DESC
          `)
        : this.db.prepare(`
            SELECT * FROM approvals
            WHERE type = 'request' AND status = 'pending' AND run_id = ? AND capability LIKE 'bash:%'
            ORDER BY created_at DESC
          `);
      const rows = sessionId
        ? stmt.all(scopeId, sessionId)
        : stmt.all(scopeId);
      return rows.map(rowToApprovalRecord) as HostBashApprovalRecord[];
    }
    const stmt = this.db.prepare(`
        SELECT * FROM approvals
        WHERE type = 'request' AND status = 'pending' AND capability LIKE 'bash:%'
        ORDER BY created_at DESC
      `);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(rowToApprovalRecord);
  }

  listWhitelist(): ApprovedHostBashEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM approvals
      WHERE type = 'grant' AND scope = 'persistent' AND capability LIKE 'bash:%'
      ORDER BY revoked_at ASC, created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(rowToWhitelistEntry);
  }

  listHistory(filters?: HostBashListFilters): HostBashApprovalRecord[] {
    const query = String(filters?.query ?? "").trim().toLowerCase();
    const status = filters?.status && filters.status !== "all" ? filters.status : null;
    const approvalMode = filters?.approvalMode && filters.approvalMode !== "all" ? filters.approvalMode : null;

    const clauses = ["type = 'request'", "status != 'pending'", "capability LIKE 'bash:%'"];
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
      SELECT * FROM approvals
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
        UPDATE approvals SET revoked_at = NULL WHERE type = 'grant' AND id = ?
      `).run(id);
    } else {
      this.db.prepare(`
        UPDATE approvals SET revoked_at = ? WHERE type = 'grant' AND id = ?
      `).run(new Date().toISOString(), id);
    }
    const row = this.db.prepare(`
      SELECT * FROM approvals WHERE type = 'grant' AND id = ? LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;
    return row ? rowToWhitelistEntry(row) : null;
  }

  deleteWhitelistEntry(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM approvals WHERE type = 'grant' AND id = ?
    `).run(id);
    return Number(result.changes ?? 0) > 0;
  }

  deleteHistoryRecord(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM approvals WHERE type = 'request' AND id = ? AND status != 'pending'
    `).run(id);
    return Number(result.changes ?? 0) > 0;
  }
}

let singleton: HostBashStore | null = null;

export function getHostBashStore(): HostBashStore {
  if (!singleton) singleton = new HostBashStore();
  return singleton;
}
