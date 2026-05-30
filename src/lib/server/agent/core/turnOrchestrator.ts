import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { resolveWorkspaceId } from "$lib/server/workspaces/store.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { RunSummary } from "$lib/server/agent/session/runSummary.js";
import { resolveModelSelection, resolveApiKeyForModel } from "$lib/server/agent/routing/modelRouting.js";
import { compactContextMessages, shouldCompactContext } from "$lib/server/agent/session/compaction.js";
import { momLog } from "$lib/server/agent/common/log.js";
import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";

export const DEFAULT_TURN_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

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
}

export interface TurnCleanupStore {
  listRunningTurns(): RunningTurnRecord[];
  markTurnFailed(id: string, error: string, finishedAt: string): void;
}

export class SqliteTurnCleanupStore implements TurnCleanupStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = storagePaths.settingsDbFile) {
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
  }

  listRunningTurns(): RunningTurnRecord[] {
    const rows = this.db.prepare("SELECT id, status, started_at FROM runs WHERE status = 'running'").all() as any[];
    return rows.map(r => ({
      id: r.id,
      status: r.status,
      startedAt: r.started_at
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

  constructor(approvalBroker?: ApprovalBroker) {
    this.approvalBroker = approvalBroker;
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

    const db = new DatabaseSync(storagePaths.settingsDbFile);
    try {
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
      `);

      // Check session locking:
      const active = db.prepare("SELECT id, started_at FROM runs WHERE session_id = ? AND status = 'running'").get(input.sessionId) as { id: string; started_at: string } | undefined;
      if (active) {
        const activeStartedAt = Date.parse(active.started_at);
        const cutoff = startedAt - DEFAULT_TURN_LOCK_TIMEOUT_MS;
        if (Number.isFinite(activeStartedAt) && activeStartedAt > cutoff) {
          throw new Error("Another run is currently active in this session.");
        } else {
          // Expire and auto-release old lock
          db.prepare("UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
            "Turn exceeded lock timeout (10 minutes) and was auto-released.",
            new Date(startedAt).toISOString(),
            active.id
          );
        }
      }

      // Security/Auth Boundary: Channel runtimes are responsible for authenticating and
      // authorizing external users/actors before invoking the shared turn orchestrator pipeline.
      // The TurnOrchestrator trusts the incoming message and persists the normalized userId
      // as actor_id purely for audit, session records, and workspace mapping.
      db.prepare(`
        INSERT OR IGNORE INTO runs (id, session_id, workspace_id, actor_id, channel_id, status, started_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?)
      `).run(
        runId,
        input.sessionId,
        workspaceId,
        input.message.userId ?? "agent-1",
        input.message.chatType ?? "web",
        new Date(startedAt).toISOString()
      );
    } finally {
      db.close();
    }

    return {
      runId,
      sessionId: input.sessionId,
      workspaceId,
      startedAt
    };
  }

  updateRunStatus(runId: string, status: string, error?: string): void {
    const db = new DatabaseSync(storagePaths.settingsDbFile);
    try {
      db.prepare("UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?").run(
        status,
        error ?? null,
        new Date().toISOString(),
        runId
      );
    } finally {
      db.close();
    }
  }

  failRunIfRunning(runId: string, error: string): boolean {
    const db = new DatabaseSync(storagePaths.settingsDbFile);
    try {
      const result = db.prepare("UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(
        error,
        new Date().toISOString(),
        runId
      );
      return Number(result.changes ?? 0) > 0;
    } finally {
      db.close();
    }
  }

  abortRunningTurnsForSession(sessionId: string, error = "Stopped by user."): number {
    const db = new DatabaseSync(storagePaths.settingsDbFile);
    try {
      const result = db.prepare("UPDATE runs SET status = 'aborted', error = ?, finished_at = ? WHERE session_id = ? AND status = 'running'").run(
        error,
        new Date().toISOString(),
        sessionId
      );
      const count = Number(result.changes ?? 0);
      if (count > 0) {
        this.approvalBroker?.revokeSessionGrants(sessionId);
      }
      return count;
    } finally {
      db.close();
    }
  }

  cleanupStaleRunningTurns(
    store: TurnCleanupStore,
    options: { now?: Date; timeoutMs?: number } = {}
  ): number {
    const now = options.now ?? new Date();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TURN_LOCK_TIMEOUT_MS;
    const cutoff = now.getTime() - timeoutMs;
    let cleaned = 0;

    for (const turn of store.listRunningTurns()) {
      if (turn.status !== "running") continue;
      const startedAt = Date.parse(turn.startedAt);
      if (!Number.isFinite(startedAt) || startedAt > cutoff) continue;

      store.markTurnFailed(
        turn.id,
        `Turn exceeded lock timeout (${timeoutMs}ms) and was marked failed during startup cleanup.`,
        now.toISOString()
      );
      cleaned += 1;
    }

    return cleaned;
  }

  async prepareTurnMemory(
    channel: string,
    chatId: string,
    queryText: string,
    memoryGateway: MemoryGateway
  ): Promise<any> {
    await memoryGateway.syncExternalMemories();
    return await memoryGateway.createPromptSnapshot(
      { channel, externalUserId: chatId },
      queryText,
      12
    );
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
    const selection = resolveModelSelection(input.settings, "text");
    const apiKey = await resolveApiKeyForModel(selection.model, input.settings);
    if (!apiKey) {
      throw new Error(`Missing API key for compaction model provider '${selection.model.provider}'.`);
    }

    const contextWindow = selection.model.contextWindow || input.settings.compaction.defaultContextWindow;
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

let turnOrchestrator: TurnOrchestrator | null = null;

export function getTurnOrchestrator(): TurnOrchestrator {
  turnOrchestrator ??= new TurnOrchestrator(getApprovalBroker());
  return turnOrchestrator;
}
