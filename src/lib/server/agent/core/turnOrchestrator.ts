import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { resolveWorkspaceId } from "$lib/server/workspaces/store.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { MemoryScope } from "$lib/server/memory/types.js";
import type { RunSummary } from "$lib/server/agent/session/runSummary.js";
import { resolveModelSelection, resolveCompactionSelection, resolveApiKeyForModel } from "$lib/server/agent/routing/modelRouting.js";
import { compactContextMessages, shouldCompactContext } from "$lib/server/agent/session/compaction.js";
import { momLog } from "$lib/server/agent/common/log.js";
import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";

export const DEFAULT_TURN_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
// Heartbeat lease: a live runner refreshes `last_heartbeat` on this interval,
// so lock liveness follows the heartbeat instead of a fixed wall-clock budget.
// Legitimate long turns (video polling, subagent chains) keep their lock as
// long as the process is alive; a crashed process frees the session after the
// heartbeat timeout instead of blocking it for the full legacy 10 minutes.
export const DEFAULT_TURN_HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const DEFAULT_TURN_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;
export const ACTIVE_TURN_CONFLICT_ERROR_MESSAGE = "Another run is currently active in this session.";

export interface TurnMetadata {
  runId: string;
  sessionId: string;
  workspaceId: string;
  startedAt: number;
}

export interface RunningTurnRecord {
  id: string;
  status: string;
  startedAt: string;
  lastHeartbeat?: string | null;
}

// Rows written before the heartbeat column existed (or by external writers)
// have no heartbeat; they keep the legacy started_at + 10-minute rule.
function resolveTurnLiveness(record: { startedAt: string; lastHeartbeat?: string | null }): {
  aliveAtMs: number;
  timeoutMs: number;
} {
  const heartbeatMs = Date.parse(record.lastHeartbeat ?? "");
  if (Number.isFinite(heartbeatMs)) {
    return { aliveAtMs: heartbeatMs, timeoutMs: DEFAULT_TURN_HEARTBEAT_TIMEOUT_MS };
  }
  return { aliveAtMs: Date.parse(record.startedAt), timeoutMs: DEFAULT_TURN_LOCK_TIMEOUT_MS };
}

function ensureRunsHeartbeatColumn(db: DatabaseSync): void {
  try {
    db.exec("ALTER TABLE runs ADD COLUMN last_heartbeat TEXT");
  } catch {
    // Column already exists.
  }
}

export interface TurnCleanupStore {
  listRunningTurns(): RunningTurnRecord[];
  markTurnFailed(id: string, error: string, finishedAt: string): void;
}

export class SqliteTurnCleanupStore implements TurnCleanupStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = storagePaths.settingsDbFile) {
    ensureSqliteParentDir(dbPath);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id),
        actor_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
    `);
    ensureRunsHeartbeatColumn(this.db);
  }

  listRunningTurns(): RunningTurnRecord[] {
    const rows = this.db.prepare("SELECT id, status, started_at, last_heartbeat FROM runs WHERE status = 'running'").all() as any[];
    return rows.map(r => ({
      id: r.id,
      status: r.status,
      startedAt: r.started_at,
      lastHeartbeat: r.last_heartbeat ?? null
    }));
  }

  markTurnFailed(id: string, error: string, finishedAt: string): void {
    this.db.prepare("UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(error, finishedAt, id);
  }

  close(): void {
    this.db.close();
  }
}

export class TurnOrchestrator {
  private readonly approvalBroker?: ApprovalBroker;
  private db: DatabaseSync | null = null;

  constructor(approvalBroker?: ApprovalBroker) {
    this.approvalBroker = approvalBroker;
  }

  // One connection per orchestrator, schema ensured once at open, instead of
  // an open/DDL/close cycle on every turn operation in the hot path.
  private getDb(): DatabaseSync {
    if (this.db) return this.db;
    ensureSqliteParentDir(storagePaths.settingsDbFile);
    const db = new DatabaseSync(storagePaths.settingsDbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT,
        enabled_skill_paths TEXT NOT NULL DEFAULT '[]',
        enabled_tool_ids TEXT NOT NULL DEFAULT '[]',
        sandbox_profile_id TEXT,
        approval_profile_id TEXT,
        memory_scope TEXT NOT NULL DEFAULT 'workspace',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id),
        actor_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
    `);
    ensureRunsHeartbeatColumn(db);
    this.db = db;
    return db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  prepareTurn(input: {
    chatId: string;
    sessionId: string;
    message: ChannelInboundMessage & { runId?: string };
    now?: number;
  }): TurnMetadata {
    const workspaceId = resolveWorkspaceId(input.message.workspaceId);
    input.message.workspaceId = workspaceId;

    const runId = input.message.runId ?? `${input.chatId}-${input.sessionId}-${input.message.messageId}`;
    input.message.runId = runId;
    const startedAt = input.now ?? Date.now();

    const db = this.getDb();

    // Check session locking. A turn holds the lock while its heartbeat is
    // fresh; a stale heartbeat means the owning process died and the lock is
    // auto-released regardless of how recently the turn started.
    const active = db.prepare("SELECT id, started_at, last_heartbeat FROM runs WHERE session_id = ? AND status = 'running'").get(input.sessionId) as { id: string; started_at: string; last_heartbeat: string | null } | undefined;
    if (active) {
      const liveness = resolveTurnLiveness({ startedAt: active.started_at, lastHeartbeat: active.last_heartbeat });
      if (Number.isFinite(liveness.aliveAtMs) && liveness.aliveAtMs > startedAt - liveness.timeoutMs) {
        throw new Error(ACTIVE_TURN_CONFLICT_ERROR_MESSAGE);
      } else {
        // Expire and auto-release the dead lock
        db.prepare("UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
          `Turn lock heartbeat expired (no heartbeat for ${liveness.timeoutMs}ms) and was auto-released.`,
          new Date(startedAt).toISOString(),
          active.id
        );
      }
    }

    // Approval continuation intentionally reuses its original run id. Move
    // the suspended row back under the normal heartbeat/commit lifecycle.
    const resumed = db.prepare(`
      UPDATE runs
      SET status = 'running', last_heartbeat = ?, finished_at = NULL, error = NULL
      WHERE id = ? AND session_id = ? AND status = 'waiting_for_approval'
    `).run(new Date(startedAt).toISOString(), runId, input.sessionId);
    if (Number(resumed.changes ?? 0) > 0) {
      return {
        runId,
        sessionId: input.sessionId,
        workspaceId,
        startedAt
      };
    }

    // Security/Auth Boundary: Channel runtimes are responsible for authenticating and
    // authorizing external users/actors before invoking the shared turn orchestrator pipeline.
    // The TurnOrchestrator trusts the incoming message and persists the normalized userId
    // as actor_id purely for audit, session records, and workspace mapping.
    db.prepare(`
      INSERT OR IGNORE INTO runs (id, session_id, workspace_id, actor_id, channel_id, status, started_at, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      runId,
      input.sessionId,
      workspaceId,
      input.message.userId ?? "agent-1",
      input.message.chatType ?? "web",
      new Date(startedAt).toISOString(),
      new Date(startedAt).toISOString()
    );

    return {
      runId,
      sessionId: input.sessionId,
      workspaceId,
      startedAt
    };
  }

  heartbeatTurn(runId: string): boolean {
    const result = this.getDb().prepare("UPDATE runs SET last_heartbeat = ? WHERE id = ? AND status = 'running'").run(
      new Date().toISOString(),
      runId
    );
    return Number(result.changes ?? 0) > 0;
  }

  /**
   * Keep the turn lock alive while the run executes. Returns a stop function;
   * callers must invoke it in a finally block once the run settles.
   */
  startTurnHeartbeat(runId: string, intervalMs = DEFAULT_TURN_HEARTBEAT_INTERVAL_MS): () => void {
    const timer = setInterval(() => {
      try {
        // A false result means the run is no longer 'running' (committed,
        // aborted, or expired by another process); stop heartbeating.
        if (!this.heartbeatTurn(runId)) clearInterval(timer);
      } catch (error) {
        momLog("runner", "turn_heartbeat_failed", {
          runId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  updateRunStatus(runId: string, status: string, error?: string): void {
    this.getDb().prepare("UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?").run(
      status,
      error ?? null,
      new Date().toISOString(),
      runId
    );
  }

  failRunIfRunning(runId: string, error: string): boolean {
    const result = this.getDb().prepare("UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(
      error,
      new Date().toISOString(),
      runId
    );
    return Number(result.changes ?? 0) > 0;
  }

  abortRunningTurnsForSession(sessionId: string, error = "Stopped by user."): number {
    const result = this.getDb().prepare("UPDATE runs SET status = 'aborted', error = ?, finished_at = ? WHERE session_id = ? AND status = 'running'").run(
      error,
      new Date().toISOString(),
      sessionId
    );
    const count = Number(result.changes ?? 0);
    if (count > 0) {
      this.approvalBroker?.revokeSessionGrants(sessionId);
    }
    return count;
  }

  cleanupStaleRunningTurns(
    store: TurnCleanupStore,
    options: { now?: Date; timeoutMs?: number; forceAll?: boolean } = {}
  ): number {
    const now = options.now ?? new Date();
    let cleaned = 0;

    for (const turn of store.listRunningTurns()) {
      if (turn.status !== "running") continue;
      const liveness = resolveTurnLiveness(turn);
      const timeoutMs = options.timeoutMs ?? liveness.timeoutMs;
      if (!options.forceAll) {
        const cutoff = now.getTime() - timeoutMs;
        if (!Number.isFinite(liveness.aliveAtMs) || liveness.aliveAtMs > cutoff) continue;
      }

      const reason = options.forceAll
        ? "Turn was marked failed because the application process restarted."
        : `Turn lock heartbeat expired (${timeoutMs}ms) and was marked failed during startup cleanup.`;

      store.markTurnFailed(
        turn.id,
        reason,
        now.toISOString()
      );
      cleaned += 1;
    }

    return cleaned;
  }

  async prepareTurnMemory(
    scope: MemoryScope,
    queryText: string,
    memoryGateway: MemoryGateway,
    options?: { sessionId?: string }
  ): Promise<any> {
    await memoryGateway.syncExternalMemories();
    const snapshot = await memoryGateway.createPromptSnapshot(
      scope,
      queryText,
      12
    );
    if (options?.sessionId && scope.botId && scope.shareOwner !== false) {
      snapshot.profile = await memoryGateway.createProfileTurnSnapshot(options.sessionId, {
        ...scope,
        ownerId: scope.ownerId ?? "owner",
        botId: scope.botId,
        includeOwner: true,
        includeAgentSelf: true
      });
    }
    return snapshot;
  }

  async compactSessionContext(input: {
    channel: string;
    chatId: string;
    sessionId: string;
    currentMessages: AgentMessage[];
    store: MomRuntimeStore;
    settings: RuntimeSettings;
    options?: {
      reason?: "threshold" | "manual";
      customInstructions?: string;
      notify?: (text: string) => Promise<void>;
      signal?: AbortSignal;
    };
  }): Promise<{
    changed: boolean;
    summary: string;
    beforeTokens: number;
    afterTokens: number;
    summarizedMessages: number;
    keptMessages: number;
    messages: AgentMessage[];
  }> {
    // The trigger decision is based on the primary text model's context window
    // (that's the model the conversation actually runs on), while the summary
    // itself can use a dedicated, cheaper compaction model when configured.
    const textSelection = resolveModelSelection(input.settings, "text");
    const selection = resolveCompactionSelection(input.settings);
    const apiKey = await resolveApiKeyForModel(selection.model, input.settings);
    if (!apiKey) {
      throw new Error(`Missing API key for compaction model provider '${selection.model.provider}'.`);
    }

    const contextWindow = textSelection.model.contextWindow || input.settings.compaction.defaultContextWindow;
    if (
      input.options?.reason !== "manual" &&
      !shouldCompactContext(input.currentMessages, contextWindow, input.settings.compaction)
    ) {
      return {
        changed: false,
        summary: "",
        beforeTokens: 0,
        afterTokens: 0,
        summarizedMessages: 0,
        keptMessages: input.currentMessages.length,
        messages: input.currentMessages
      };
    }

    const result = await compactContextMessages({
      messages: input.currentMessages,
      model: selection.model,
      apiKey,
      settings: input.settings.compaction,
      reason: input.options?.reason ?? "manual",
      customInstructions: input.options?.customInstructions,
      signal: input.options?.signal
    });
    if (!result.changed) {
      return {
        changed: false,
        summary: "",
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        summarizedMessages: 0,
        keptMessages: result.keptMessages,
        messages: input.currentMessages
      };
    }

    input.store.appendCompaction(
      input.chatId,
      result.summary,
      result.messages.slice(1),
      result.beforeTokens,
      result.afterTokens,
      result.summarizedMessages,
      result.reason,
      input.sessionId
    );
    momLog("runner", "context_compacted", {
      chatId: input.chatId,
      sessionId: input.sessionId,
      reason: result.reason,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      summarizedMessages: result.summarizedMessages,
      keptMessages: result.keptMessages
    });
    if (input.options?.notify) {
      await input.options.notify(
        [
          `Context compacted (${result.reason}).`,
          `before≈${result.beforeTokens} tokens`,
          `after≈${result.afterTokens} tokens`,
          `summarized_messages=${result.summarizedMessages}`,
          `kept_messages=${result.keptMessages}`
        ].join("\n")
      );
    }

    return {
      changed: true,
      summary: result.summary,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      summarizedMessages: result.summarizedMessages,
      keptMessages: result.keptMessages,
      messages: result.messages
    };
  }

  commitTurn(chatId: string, runSummary: RunSummary, store: MomRuntimeStore): void {
    store.appendRunSummary(chatId, runSummary as unknown as Record<string, unknown>);
    const runStatus = runSummary.stopReason === "stop"
      ? "completed"
      : ((runSummary.stopReason as string) === "aborted"
        ? "aborted"
        : (runSummary.stopReason === "waiting_for_approval" ? "waiting_for_approval" : "failed"));
    this.updateRunStatus(runSummary.runId, runStatus, runSummary.errorMessage);
    this.approvalBroker?.revokeTurnGrants(runSummary.runId);
  }
}

export function isActiveTurnConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(ACTIVE_TURN_CONFLICT_ERROR_MESSAGE);
}

let turnOrchestrator: TurnOrchestrator | null = null;

export function getTurnOrchestrator(): TurnOrchestrator {
  turnOrchestrator ??= new TurnOrchestrator(getApprovalBroker());
  return turnOrchestrator;
}
