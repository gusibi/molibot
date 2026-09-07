import type { Conversation } from "$lib/shared/types/message.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import {
  SessionLifecycleVersionConflictError,
  type SessionLifecycleRow,
  type SessionLifecycleState,
  type SessionLifecycleStore
} from "$lib/server/sessions/sessionLifecycleStore.js";

export type LifecycleSkipReason =
  | "not_found"
  | "unauthorized"
  | "busy"
  | "protected"
  | "stale_version"
  | "not_applicable";

export type LifecycleItemOutcome =
  | { status: "succeeded"; conversationId: string; state: SessionLifecycleState; version: number }
  | { status: "skipped"; conversationId: string; reason: LifecycleSkipReason; detail?: string }
  | { status: "failed"; conversationId: string; reason: string };

export interface LifecycleQueryItem {
  conversation: Conversation;
  lifecycle: SessionLifecycleRow;
}

type SessionsPort = Pick<
  SessionStore,
  | "getWebConversationOwner"
  | "getConversationById"
  | "getConversationProjectId"
  | "getProjectConversation"
  | "listConversations"
  | "listProjectConversations"
  | "listMessageMetadata"
  | "removeConversationSearchProjection"
  | "restoreConversationSearchProjection"
>;

export interface SessionLifecycleServiceDeps {
  sessions: SessionsPort;
  lifecycle: SessionLifecycleStore;
  /** Running work, queued work, pending approvals or nonterminal linked tasks block archive/deletion. */
  isBusy?: (conversationId: string) => boolean;
  clock?: () => Date;
  trashRetentionDays?: number;
}

interface LocatedSession {
  conversation: Conversation;
  ownerExternalUserId: string | null;
}

const TRASH_RETENTION_DAYS = 30;

/**
 * Shared application-layer Session lifecycle service. Channel adapters only
 * translate/transport messages; all querying, eligibility and mutation live
 * here. Authorization is rechecked against the Session-owned store on every
 * query and operation — a caller-supplied id never grants access by itself.
 */
export class SessionLifecycleService {
  private readonly sessions: SessionsPort;
  private readonly lifecycle: SessionLifecycleStore;
  private readonly isBusy: (conversationId: string) => boolean;
  private readonly clock: () => Date;
  private readonly trashRetentionDays: number;

  constructor(deps: SessionLifecycleServiceDeps) {
    this.sessions = deps.sessions;
    this.lifecycle = deps.lifecycle;
    this.isBusy = deps.isBusy ?? (() => false);
    this.clock = deps.clock ?? (() => new Date());
    this.trashRetentionDays = deps.trashRetentionDays ?? TRASH_RETENTION_DAYS;
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private locate(conversationId: string): LocatedSession | null {
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    const owner = this.sessions.getWebConversationOwner(id);
    if (owner) {
      const conversation = this.sessions.getConversationById(id, "web", owner);
      return conversation ? { conversation, ownerExternalUserId: owner } : null;
    }
    const projectId = this.sessions.getConversationProjectId(id);
    if (projectId) {
      const conversation = this.sessions.getProjectConversation(projectId, id);
      return conversation ? { conversation, ownerExternalUserId: null } : null;
    }
    return null;
  }

  private checkAccess(
    located: LocatedSession | null,
    requesterExternalUserId?: string
  ): located is LocatedSession {
    if (!located) return false;
    if (requesterExternalUserId === undefined) return true;
    // Project conversations are deliberately owner-shared; Web conversations
    // belong to exactly one externalUserId.
    if (located.ownerExternalUserId === null) return true;
    return located.ownerExternalUserId === requesterExternalUserId;
  }

  private skipped(conversationId: string, reason: LifecycleSkipReason, detail?: string): LifecycleItemOutcome {
    return detail === undefined
      ? { status: "skipped", conversationId, reason }
      : { status: "skipped", conversationId, reason, detail };
  }

  private authorizedRow(
    conversationId: string,
    requesterExternalUserId?: string
  ): { located: LocatedSession; row: SessionLifecycleRow } | LifecycleItemOutcome {
    const located = this.locate(conversationId);
    if (!located) return this.skipped(conversationId, "not_found");
    if (!this.checkAccess(located, requesterExternalUserId)) {
      return this.skipped(conversationId, "unauthorized");
    }
    const row = this.lifecycle.ensureRow(located.conversation.id, {
      createdAt: located.conversation.createdAt,
      lastActivityAt: this.lastActivityFromMessages(located.conversation.id) ?? null
    });
    return { located, row };
  }

  /** Max createdAt over user/assistant messages — existing evidence only, never fabricated. */
  private lastActivityFromMessages(conversationId: string): string | undefined {
    let latest: string | undefined;
    for (const message of this.sessions.listMessageMetadata(conversationId)) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      if (!message.createdAt) continue;
      if (latest === undefined || message.createdAt > latest) latest = message.createdAt;
    }
    return latest;
  }

  private mutate(
    conversationId: string,
    row: SessionLifecycleRow,
    patch: Parameters<SessionLifecycleStore["updateWithVersion"]>[2],
    expectedVersion?: number
  ): SessionLifecycleRow {
    return this.lifecycle.updateWithVersion(conversationId, expectedVersion ?? row.version, patch);
  }

  /**
   * Advances last conversation activity for accepted conversational messages
   * and visible assistant replies only. Metadata-only changes (open, rename,
   * index, extract, lifecycle edits) must not call this.
   */
  recordConversationActivity(
    conversationId: string,
    message: { role: string; createdAt?: string }
  ): SessionLifecycleRow | null {
    if (message.role !== "user" && message.role !== "assistant") return null;
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    const createdAt = message.createdAt ?? this.nowIso();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = this.lifecycle.ensureRow(id);
      if (current.lastActivityAt !== null && createdAt <= current.lastActivityAt) return current;
      try {
        return this.lifecycle.updateWithVersion(id, current.version, { lastActivityAt: createdAt });
      } catch (error) {
        if (!(error instanceof SessionLifecycleVersionConflictError) || attempt === 2) throw error;
      }
    }
    return this.lifecycle.get(id);
  }

  query(options?: {
    requesterExternalUserId?: string;
    state?: SessionLifecycleState;
    projectId?: string;
  }): LifecycleQueryItem[] {
    const state = options?.state ?? "active";
    const conversations = options?.projectId
      ? this.sessions.listProjectConversations(options.projectId)
      : options?.requesterExternalUserId !== undefined
        ? this.sessions.listConversations("web", options.requesterExternalUserId)
        : [];
    const items: LifecycleQueryItem[] = [];
    for (const conversation of conversations) {
      const located: LocatedSession = {
        conversation,
        ownerExternalUserId: options?.projectId ? null : (options?.requesterExternalUserId ?? null)
      };
      if (!this.checkAccess(located, options?.requesterExternalUserId)) continue;
      const lifecycle = this.lifecycle.ensureRow(conversation.id, {
        createdAt: conversation.createdAt,
        lastActivityAt: this.lastActivityFromMessages(conversation.id) ?? null
      });
      if (lifecycle.state !== state) continue;
      items.push({ conversation, lifecycle });
    }
    items.sort((a, b) => {
      const activityA = a.lifecycle.lastActivityAt ?? a.conversation.createdAt;
      const activityB = b.lifecycle.lastActivityAt ?? b.conversation.createdAt;
      if (activityA !== activityB) return activityB.localeCompare(activityA);
      return a.conversation.id.localeCompare(b.conversation.id);
    });
    return items;
  }

  archive(input: { conversationId: string; requesterExternalUserId?: string; expectedVersion?: number }): LifecycleItemOutcome {
    const resolved = this.authorizedRow(input.conversationId, input.requesterExternalUserId);
    if (!("located" in resolved)) return resolved;
    const { row } = resolved;
    if (row.state === "archived") {
      return { status: "succeeded", conversationId: row.conversationId, state: row.state, version: row.version };
    }
    if (row.state === "trashed") return this.skipped(row.conversationId, "not_applicable", "trashed sessions restore instead of archiving");
    if (this.isBusy(row.conversationId)) return this.skipped(row.conversationId, "busy");
    try {
      const next = this.mutate(row.conversationId, row, { state: "archived", archivedAt: this.nowIso() }, input.expectedVersion);
      return { status: "succeeded", conversationId: next.conversationId, state: next.state, version: next.version };
    } catch (error) {
      if (error instanceof SessionLifecycleVersionConflictError) return this.skipped(row.conversationId, "stale_version");
      return { status: "failed", conversationId: row.conversationId, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  restoreArchived(input: { conversationId: string; requesterExternalUserId?: string; expectedVersion?: number }): LifecycleItemOutcome {
    const resolved = this.authorizedRow(input.conversationId, input.requesterExternalUserId);
    if (!("located" in resolved)) return resolved;
    const { row } = resolved;
    if (row.state === "active") {
      return { status: "succeeded", conversationId: row.conversationId, state: row.state, version: row.version };
    }
    if (row.state !== "archived") return this.skipped(row.conversationId, "not_applicable", `state is ${row.state}`);
    try {
      const next = this.mutate(row.conversationId, row, { state: "active", archivedAt: null }, input.expectedVersion);
      return { status: "succeeded", conversationId: next.conversationId, state: next.state, version: next.version };
    } catch (error) {
      if (error instanceof SessionLifecycleVersionConflictError) return this.skipped(row.conversationId, "stale_version");
      return { status: "failed", conversationId: row.conversationId, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  trash(input: { conversationId: string; requesterExternalUserId?: string; expectedVersion?: number }): LifecycleItemOutcome {
    const resolved = this.authorizedRow(input.conversationId, input.requesterExternalUserId);
    if (!("located" in resolved)) return resolved;
    const { located, row } = resolved;
    if (row.state === "trashed") {
      return { status: "succeeded", conversationId: row.conversationId, state: row.state, version: row.version };
    }
    if (row.retain) return this.skipped(row.conversationId, "protected", "remove the long-term retention marker before deletion");
    if (this.isBusy(row.conversationId)) return this.skipped(row.conversationId, "busy");
    try {
      const preTrashState = row.state === "archived" ? "archived" : "active";
      const next = this.mutate(
        row.conversationId,
        row,
        { state: "trashed", trashedAt: this.nowIso(), preTrashState },
        input.expectedVersion
      );
      // Recoverable delete: the transcript and Agent Context stay in place for
      // full restore; only the search projection is removed immediately.
      this.sessions.removeConversationSearchProjection(located.conversation);
      return { status: "succeeded", conversationId: next.conversationId, state: next.state, version: next.version };
    } catch (error) {
      if (error instanceof SessionLifecycleVersionConflictError) return this.skipped(row.conversationId, "stale_version");
      return { status: "failed", conversationId: row.conversationId, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  restoreTrashed(input: { conversationId: string; requesterExternalUserId?: string; expectedVersion?: number }): LifecycleItemOutcome {
    const resolved = this.authorizedRow(input.conversationId, input.requesterExternalUserId);
    if (!("located" in resolved)) return resolved;
    const { located, row } = resolved;
    if (row.state !== "trashed") {
      return row.state === "active" || row.state === "archived"
        ? { status: "succeeded", conversationId: row.conversationId, state: row.state, version: row.version }
        : this.skipped(row.conversationId, "not_applicable", `state is ${row.state}`);
    }
    try {
      const restoreTo = row.preTrashState === "archived" ? "archived" : "active";
      const next = this.mutate(
        row.conversationId,
        row,
        { state: restoreTo, trashedAt: null, preTrashState: null },
        input.expectedVersion
      );
      this.sessions.restoreConversationSearchProjection(located.conversation);
      return { status: "succeeded", conversationId: next.conversationId, state: next.state, version: next.version };
    } catch (error) {
      if (error instanceof SessionLifecycleVersionConflictError) return this.skipped(row.conversationId, "stale_version");
      return { status: "failed", conversationId: row.conversationId, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  setRetain(input: { conversationId: string; retain: boolean; requesterExternalUserId?: string; expectedVersion?: number }): LifecycleItemOutcome {
    const resolved = this.authorizedRow(input.conversationId, input.requesterExternalUserId);
    if (!("located" in resolved)) return resolved;
    const { row } = resolved;
    try {
      const next = this.mutate(row.conversationId, row, { retain: input.retain }, input.expectedVersion);
      return { status: "succeeded", conversationId: next.conversationId, state: next.state, version: next.version };
    } catch (error) {
      if (error instanceof SessionLifecycleVersionConflictError) return this.skipped(row.conversationId, "stale_version");
      return { status: "failed", conversationId: row.conversationId, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Permanently clears trashed sessions whose recovery period has expired.
   * The injected `purge` owns the cross-store deletion (UI file, Agent
   * Context, search finalization, lifecycle row); failures stay as
   * recoverable cleanup work and never resurrect the session.
   */
  purgeExpired(options: {
    now?: Date;
    purge: (conversationId: string) => void;
    requesterExternalUserId?: string;
  }): LifecycleItemOutcome[] {
    const nowMs = (options.now ?? this.clock()).getTime();
    const outcomes: LifecycleItemOutcome[] = [];
    for (const row of this.lifecycle.listByState("trashed")) {
      if (!row.trashedAt) continue;
      const ageMs = nowMs - Date.parse(row.trashedAt);
      if (!Number.isFinite(ageMs) || ageMs < this.trashRetentionDays * 86_400_000) continue;
      if (options.requesterExternalUserId !== undefined) {
        const located = this.locate(row.conversationId);
        if (!this.checkAccess(located, options.requesterExternalUserId)) {
          outcomes.push(this.skipped(row.conversationId, "unauthorized"));
          continue;
        }
      }
      try {
        options.purge(row.conversationId);
        outcomes.push({ status: "succeeded", conversationId: row.conversationId, state: "trashed", version: row.version });
      } catch (error) {
        outcomes.push({ status: "failed", conversationId: row.conversationId, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcomes;
  }
}
