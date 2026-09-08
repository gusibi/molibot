import type { LifecycleItemOutcome } from "$lib/server/sessions/sessionLifecycleService.js";
import type { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";

/**
 * Cross-store purge ports. Every step only touches Session-owned data:
 * the UI conversation file, the linked Agent Context files and the
 * conversation search projection. Saved memories, independent documents,
 * Project root files and shared artifacts are never reachable from here.
 * Each step treats "already gone" as success so retries stay idempotent.
 */
export interface SessionTrashCleanupPorts {
  lifecycle: SessionLifecycleStore;
  clock?: () => Date;
  trashRetentionDays?: number;
  /** Removes the Session-owned UI conversation file. Missing counts as success; failure throws. */
  deleteUiConversation: (conversationId: string) => void;
  /** Chat scopes that may hold this session's Agent Context. */
  listAgentChatIds: (conversationId: string) => string[];
  /** Removes Session-owned Agent Context files. Missing counts as success; failure throws. */
  deleteAgentSession: (chatId: string, sessionId: string) => void;
  /** Finalizes search deletion (durable tombstone; nothing can resurrect the projection). */
  finalizeSearchConversation: (conversationId: string) => void;
  /** Ownership recheck before purging someone else's trash. Defaults to allow. */
  isAuthorized?: (conversationId: string, requesterExternalUserId: string) => boolean;
}

const TRASH_RETENTION_DAYS = 30;

function failure(conversationId: string, reason: string): LifecycleItemOutcome {
  return { status: "failed", conversationId, reason };
}

/**
 * Shared application-layer expired-trash cleanup. Channel adapters never own
 * deletion policy; the runtime maintenance sweep calls
 * {@link purgeExpiredTrash} and {@link reconcilePending} through the existing
 * watched-event/Runtime Event path.
 *
 * Failure contract: a partial failure never resurrects the session — the
 * trashed lifecycle row stays until every step succeeds, and the remaining
 * work is recorded as a recoverable cleanup intent for startup
 * reconciliation.
 */
export class SessionTrashCleanupService {
  private readonly lifecycle: SessionLifecycleStore;
  private readonly clock: () => Date;
  private readonly trashRetentionDays: number;
  private readonly ports: SessionTrashCleanupPorts;

  constructor(ports: SessionTrashCleanupPorts) {
    this.lifecycle = ports.lifecycle;
    this.clock = ports.clock ?? (() => new Date());
    this.trashRetentionDays = ports.trashRetentionDays ?? TRASH_RETENTION_DAYS;
    this.ports = ports;
  }

  private isExpired(trashedAt: string | null, nowMs: number): boolean {
    if (!trashedAt) return false;
    const ageMs = nowMs - Date.parse(trashedAt);
    return Number.isFinite(ageMs) && ageMs >= this.trashRetentionDays * 86_400_000;
  }

  /**
   * Purges every trashed session past the 30-day recovery period. Each purge
   * is idempotent; failures keep the session trashed with a recorded intent.
   */
  purgeExpiredTrash(options?: { now?: Date; requesterExternalUserId?: string }): LifecycleItemOutcome[] {
    const nowMs = (options?.now ?? this.clock()).getTime();
    const outcomes: LifecycleItemOutcome[] = [];
    for (const row of this.lifecycle.listByState("trashed")) {
      if (!this.isExpired(row.trashedAt, nowMs)) continue;
      if (options?.requesterExternalUserId !== undefined && this.ports.isAuthorized) {
        if (!this.ports.isAuthorized(row.conversationId, options.requesterExternalUserId)) {
          outcomes.push({
            status: "skipped",
            conversationId: row.conversationId,
            reason: "unauthorized"
          });
          continue;
        }
      }
      outcomes.push(this.purgeOne(row.conversationId));
    }
    return outcomes;
  }

  /**
   * Startup reconciliation: retries recorded cleanup intents, then sweeps
   * expired trash to cover crashes that happened before an intent was
   * recorded. A session restored to active/archived since the failure is
   * left alone — restore always wins over a stale intent.
   */
  reconcilePending(options?: { now?: Date }): LifecycleItemOutcome[] {
    const outcomes: LifecycleItemOutcome[] = [];
    for (const intent of this.lifecycle.listCleanupIntents()) {
      const row = this.lifecycle.get(intent.conversationId);
      if (!row) {
        this.lifecycle.clearCleanupIntent(intent.conversationId);
        continue;
      }
      if (row.state !== "trashed") {
        this.lifecycle.clearCleanupIntent(intent.conversationId);
        continue;
      }
      outcomes.push(this.purgeOne(intent.conversationId));
    }
    for (const item of this.purgeExpiredTrash(options)) {
      if (!outcomes.some((outcome) => outcome.conversationId === item.conversationId)) outcomes.push(item);
    }
    return outcomes;
  }

  /**
   * Single-session purge behind the lifecycle `purgeExpired({ purge })`
   * callback: purges only when the session is still trashed and expired,
   * throws on partial failure so the caller records a `failed` item.
   */
  purgeSingleExpired(conversationId: string, now?: Date): void {
    const id = String(conversationId ?? "").trim();
    const row = id ? this.lifecycle.get(id) : null;
    if (!row || row.state !== "trashed") return;
    if (!this.isExpired(row.trashedAt, (now ?? this.clock()).getTime())) return;
    const outcome = this.purgeOne(id);
    if (outcome.status === "failed") throw new Error(outcome.reason);
  }

  private purgeOne(conversationId: string): LifecycleItemOutcome {
    const row = this.lifecycle.get(conversationId);
    const version = row?.version ?? 0;
    const steps: Array<{ name: string; run: () => void }> = [
      { name: "search", run: () => this.ports.finalizeSearchConversation(conversationId) },
      { name: "ui", run: () => this.ports.deleteUiConversation(conversationId) },
      {
        name: "agent",
        run: () => {
          for (const chatId of this.ports.listAgentChatIds(conversationId)) {
            this.ports.deleteAgentSession(chatId, conversationId);
          }
        }
      }
    ];
    for (const step of steps) {
      try {
        step.run();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.lifecycle.recordCleanupIntent(conversationId, step.name, reason);
        return failure(conversationId, `${step.name}: ${reason}`);
      }
    }
    this.lifecycle.deleteRow(conversationId);
    this.lifecycle.clearCleanupIntent(conversationId);
    return { status: "succeeded", conversationId, state: "trashed", version };
  }
}
