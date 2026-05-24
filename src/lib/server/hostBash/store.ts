import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "../infra/db/storage.js";
import {
  coerceApprovalMode,
  createHostBashApprovalRecord,
  defaultHostBashPermissions,
  sanitizeHostBashId,
  sanitizeHostBashPendingAction,
  sanitizeHostBashPermissions
} from "./approval.js";
import type {
  ApprovedHostBashEntry,
  HostBashApprovalRecord,
  HostBashApprovalStatus,
  HostBashListFilters
} from "./types.js";

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

function boolFromSql(value: unknown): boolean {
  return Number(value) === 1;
}

function normalizeStatus(input: unknown): HostBashApprovalStatus {
  const value = String(input ?? "").trim();
  if (value === "approved" || value === "rejected" || value === "executed" || value === "failed") return value;
  return "pending";
}

function rowToApprovalRecord(row: Record<string, unknown>): HostBashApprovalRecord {
  return {
    id: String(row.id ?? ""),
    toolId: String(row.tool_id ?? ""),
    displayName: String(row.display_name ?? ""),
    command: String(row.command ?? ""),
    reason: String(row.reason ?? ""),
    channel: String(row.channel ?? ""),
    chatId: String(row.chat_id ?? ""),
    scopeId: String(row.scope_id ?? ""),
    sessionId: String(row.session_id ?? "").trim() || undefined,
    approvalMode: coerceApprovalMode(row.approval_mode),
    status: normalizeStatus(row.status),
    permissions: sanitizeHostBashPermissions(parseJson(String(row.permissions_json ?? "{}"), {})),
    pendingAction: sanitizeHostBashPendingAction(parseJson(String(row.pending_action_json ?? "null"), null)),
    requestedAt: String(row.requested_at ?? ""),
    resolvedAt: String(row.resolved_at ?? "").trim() || undefined,
    executedAt: String(row.executed_at ?? "").trim() || undefined,
    approvedBashId: String(row.approved_bash_id ?? "").trim() || undefined,
    errorText: String(row.error_text ?? "").trim() || undefined
  };
}

function rowToWhitelistEntry(row: Record<string, unknown>): ApprovedHostBashEntry {
  return {
    id: String(row.id ?? ""),
    toolId: String(row.tool_id ?? ""),
    displayName: String(row.display_name ?? ""),
    command: String(row.command ?? ""),
    reason: String(row.reason ?? ""),
    channel: String(row.channel ?? ""),
    chatId: String(row.chat_id ?? ""),
    scopeId: String(row.scope_id ?? ""),
    permissions: sanitizeHostBashPermissions(parseJson(String(row.permissions_json ?? "{}"), {})),
    approvedAt: String(row.approved_at ?? ""),
    approvedFromRecordId: String(row.approved_from_record_id ?? ""),
    enabled: boolFromSql(row.enabled)
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
      CREATE TABLE IF NOT EXISTS host_bash_approval_records (
        id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        reason TEXT NOT NULL,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        session_id TEXT,
        approval_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        pending_action_json TEXT,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        executed_at TEXT,
        approved_bash_id TEXT,
        error_text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_host_bash_records_scope_requested
        ON host_bash_approval_records(scope_id, requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_host_bash_records_status_requested
        ON host_bash_approval_records(status, requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_host_bash_records_mode_status_requested
        ON host_bash_approval_records(approval_mode, status, requested_at DESC);

      CREATE TABLE IF NOT EXISTS host_bash_whitelist (
        id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        reason TEXT NOT NULL,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        approved_from_record_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_host_bash_whitelist_enabled_tool
        ON host_bash_whitelist(enabled, tool_id);
      CREATE INDEX IF NOT EXISTS idx_host_bash_whitelist_scope_enabled
        ON host_bash_whitelist(scope_id, enabled);
    `);
  }

  hasAnyData(): boolean {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM host_bash_approval_records) AS record_count,
        (SELECT COUNT(*) FROM host_bash_whitelist) AS whitelist_count
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
      INSERT OR IGNORE INTO host_bash_approval_records (
        id, tool_id, display_name, command, reason, channel, chat_id, scope_id, session_id,
        approval_mode, status, permissions_json, pending_action_json, requested_at, resolved_at,
        executed_at, approved_bash_id, error_text
      ) VALUES (
        @id, @tool_id, @display_name, @command, @reason, @channel, @chat_id, @scope_id, @session_id,
        @approval_mode, @status, @permissions_json, @pending_action_json, @requested_at, @resolved_at,
        @executed_at, @approved_bash_id, @error_text
      )
    `);
    const insertWhitelist = this.db.prepare(`
      INSERT OR IGNORE INTO host_bash_whitelist (
        id, tool_id, display_name, command, reason, channel, chat_id, scope_id,
        permissions_json, approved_at, approved_from_record_id, enabled
      ) VALUES (
        @id, @tool_id, @display_name, @command, @reason, @channel, @chat_id, @scope_id,
        @permissions_json, @approved_at, @approved_from_record_id, @enabled
      )
    `);

    for (const row of [...approvalHistory, ...pendingApprovals]) {
      const command = String(row.command ?? "").trim();
      const toolId = sanitizeHostBashId(row.toolId ?? command);
      if (!toolId || !command) continue;
      insertRecord.run({
        id: String(row.id ?? `legacy-${toolId}-${Date.now().toString(36)}`),
        tool_id: toolId,
        display_name: String(row.displayName ?? toolId).trim() || toolId,
        command,
        reason: String(row.reason ?? "").trim(),
        channel: String(row.channel ?? "").trim(),
        chat_id: String(row.chatId ?? "").trim(),
        scope_id: String(row.scopeId ?? "").trim(),
        session_id: null,
        approval_mode: coerceApprovalMode(row.approvalMode),
        status: normalizeStatus(row.status),
        permissions_json: toSqlJson(sanitizeHostBashPermissions(row.permissions ?? defaultHostBashPermissions)),
        pending_action_json: row.pendingAction ? toSqlJson({
          ...row.pendingAction,
          kind: String(row.pendingAction.kind ?? "").trim() === "run_approved_host_tool"
            ? "run_approved_host_bash"
            : row.pendingAction.kind
        }) : null,
        requested_at: String(row.requestedAt ?? new Date().toISOString()).trim() || new Date().toISOString(),
        resolved_at: String(row.resolvedAt ?? "").trim() || null,
        executed_at: null,
        approved_bash_id: null,
        error_text: null
      });
    }

    for (const row of approvedTools) {
      const command = String(row.command ?? "").trim();
      const toolId = sanitizeHostBashId(row.toolId ?? command);
      if (!toolId || !command) continue;
      const approvedFromRecordId = String(row.approvedFromRequestId ?? `legacy-${toolId}`).trim() || `legacy-${toolId}`;
      insertWhitelist.run({
        id: `hbw-${toolId}`,
        tool_id: toolId,
        display_name: String(row.displayName ?? toolId).trim() || toolId,
        command,
        reason: String(row.reason ?? "").trim(),
        channel: String(row.channel ?? "").trim(),
        chat_id: String(row.chatId ?? "").trim(),
        scope_id: String(row.scopeId ?? "").trim(),
        permissions_json: toSqlJson(sanitizeHostBashPermissions(row.permissions ?? defaultHostBashPermissions)),
        approved_at: String(row.approvedAt ?? new Date().toISOString()).trim() || new Date().toISOString(),
        approved_from_record_id: approvedFromRecordId,
        enabled: row.enabled === false ? 0 : 1
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

    this.db.prepare(`
      INSERT INTO host_bash_approval_records (
        id, tool_id, display_name, command, reason, channel, chat_id, scope_id, session_id,
        approval_mode, status, permissions_json, pending_action_json, requested_at, resolved_at,
        executed_at, approved_bash_id, error_text
      ) VALUES (
        @id, @tool_id, @display_name, @command, @reason, @channel, @chat_id, @scope_id, @session_id,
        @approval_mode, @status, @permissions_json, @pending_action_json, @requested_at, NULL, NULL, NULL, NULL
      )
    `).run({
      id: record.id,
      tool_id: record.toolId,
      display_name: record.displayName,
      command: record.command,
      reason: record.reason,
      channel: record.channel,
      chat_id: record.chatId,
      scope_id: record.scopeId,
      session_id: record.sessionId ?? null,
      approval_mode: record.approvalMode,
      status: record.status,
      permissions_json: toSqlJson(record.permissions),
      pending_action_json: record.pendingAction ? toSqlJson(record.pendingAction) : null,
      requested_at: record.requestedAt
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
      this.db.prepare(`
        INSERT INTO host_bash_whitelist (
          id, tool_id, display_name, command, reason, channel, chat_id, scope_id,
          permissions_json, approved_at, approved_from_record_id, enabled
        ) VALUES (
          @id, @tool_id, @display_name, @command, @reason, @channel, @chat_id, @scope_id,
          @permissions_json, @approved_at, @approved_from_record_id, 1
        )
        ON CONFLICT(tool_id) DO UPDATE SET
          display_name = excluded.display_name,
          command = excluded.command,
          reason = excluded.reason,
          channel = excluded.channel,
          chat_id = excluded.chat_id,
          scope_id = excluded.scope_id,
          permissions_json = excluded.permissions_json,
          approved_at = excluded.approved_at,
          approved_from_record_id = excluded.approved_from_record_id,
          enabled = 1
      `).run({
        id: whitelistId,
        tool_id: record.toolId,
        display_name: record.displayName,
        command: record.command,
        reason: record.reason,
        channel: record.channel,
        chat_id: record.chatId,
        scope_id: record.scopeId,
        permissions_json: toSqlJson(record.permissions),
        approved_at: now,
        approved_from_record_id: record.id
      });
      approved = this.getApprovedEntry(record.toolId) ?? undefined;
    }

    this.db.prepare(`
      UPDATE host_bash_approval_records
      SET status = 'approved',
          resolved_at = @resolved_at,
          approved_bash_id = @approved_bash_id,
          error_text = NULL
      WHERE id = @id
    `).run({
      id: record.id,
      resolved_at: now,
      approved_bash_id: approved?.id ?? null
    });

    return { record: this.getApprovalRecord(record.id) ?? { ...record, status: "approved", resolvedAt: now }, approved };
  }

  reject(scopeId: string, approvalId?: string): HostBashApprovalRecord | null {
    const record = this.getPendingApproval(scopeId, approvalId);
    if (!record) return null;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE host_bash_approval_records
      SET status = 'rejected',
          resolved_at = @resolved_at,
          error_text = NULL
      WHERE id = @id
    `).run({ id: record.id, resolved_at: now });
    return this.getApprovalRecord(record.id) ?? { ...record, status: "rejected", resolvedAt: now };
  }

  markExecution(recordId: string, status: "executed" | "failed", errorText?: string): void {
    this.db.prepare(`
      UPDATE host_bash_approval_records
      SET status = @status,
          executed_at = @executed_at,
          error_text = @error_text
      WHERE id = @id
    `).run({
      id: recordId,
      status,
      executed_at: new Date().toISOString(),
      error_text: errorText ? String(errorText).slice(0, 4000) : null
    });
  }

  getApprovalRecord(recordId: string): HostBashApprovalRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM host_bash_approval_records WHERE id = ? LIMIT 1
    `).get(recordId) as Record<string, unknown> | undefined;
    return row ? rowToApprovalRecord(row) : null;
  }

  getApprovedEntry(toolId: string): ApprovedHostBashEntry | null {
    const normalizedId = sanitizeHostBashId(toolId);
    if (!normalizedId) return null;
    const row = this.db.prepare(`
      SELECT * FROM host_bash_whitelist WHERE tool_id = ? LIMIT 1
    `).get(normalizedId) as Record<string, unknown> | undefined;
    return row ? rowToWhitelistEntry(row) : null;
  }

  listPending(scopeId?: string): HostBashApprovalRecord[] {
    const stmt = scopeId
      ? this.db.prepare(`
          SELECT * FROM host_bash_approval_records
          WHERE status = 'pending' AND scope_id = ?
          ORDER BY requested_at DESC
        `)
      : this.db.prepare(`
          SELECT * FROM host_bash_approval_records
          WHERE status = 'pending'
          ORDER BY requested_at DESC
        `);
    const rows = (scopeId ? stmt.all(scopeId) : stmt.all()) as Array<Record<string, unknown>>;
    return rows.map(rowToApprovalRecord);
  }

  listWhitelist(): ApprovedHostBashEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM host_bash_whitelist
      ORDER BY enabled DESC, approved_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(rowToWhitelistEntry);
  }

  listHistory(filters?: HostBashListFilters): HostBashApprovalRecord[] {
    const query = String(filters?.query ?? "").trim().toLowerCase();
    const status = filters?.status && filters.status !== "all" ? filters.status : null;
    const approvalMode = filters?.approvalMode && filters.approvalMode !== "all" ? filters.approvalMode : null;

    const clauses = ["status != 'pending'"];
    const params: Array<string> = [];
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    if (approvalMode) {
      clauses.push("approval_mode = ?");
      params.push(approvalMode);
    }

    const rows = this.db.prepare(`
      SELECT * FROM host_bash_approval_records
      WHERE ${clauses.join(" AND ")}
      ORDER BY COALESCE(executed_at, resolved_at, requested_at) DESC
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
    this.db.prepare(`
      UPDATE host_bash_whitelist SET enabled = ? WHERE id = ?
    `).run(enabled ? 1 : 0, id);
    const row = this.db.prepare(`
      SELECT * FROM host_bash_whitelist WHERE id = ? LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;
    return row ? rowToWhitelistEntry(row) : null;
  }

  deleteWhitelistEntry(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM host_bash_whitelist WHERE id = ?
    `).run(id);
    return Number(result.changes ?? 0) > 0;
  }

  deleteHistoryRecord(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM host_bash_approval_records WHERE id = ? AND status != 'pending'
    `).run(id);
    return Number(result.changes ?? 0) > 0;
  }
}

let singleton: HostBashStore | null = null;

export function getHostBashStore(): HostBashStore {
  if (!singleton) singleton = new HostBashStore();
  return singleton;
}
