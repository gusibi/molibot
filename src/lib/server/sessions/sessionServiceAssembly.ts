import {
  SessionLifecycleService,
  type SessionLifecycleServiceDeps
} from "$lib/server/sessions/sessionLifecycleService.js";
import type { ExternalManagedCandidate } from "$lib/server/sessions/sessionQueryService.js";

/**
 * Controllable inputs for the shared busy probe. Archive and deletion refuse
 * busy targets; the probe answers "does this conversation have running work,
 * queued work, a pending approval or a nonterminal linked task right now".
 *
 * Production passes the real readers (see `app/sessionMaintenance.ts`).
 * Tests pass controlled readers through the same assembly function and assert
 * the observable outcome (busy skips), never internal calls.
 */
export interface SessionBusyReaders {
  /** Conversation ids with a live runner turn (running work). */
  listRunningSessionIds?: () => string[];
  /** Conversation ids with a pending host-tool approval (waiting work). */
  listPendingApprovalSessionIds?: () => string[];
  /** True while a linked Runtime Task or Durable Execution is nonterminal. */
  hasNonterminalLinkedTask?: (conversationId: string) => boolean;
}

export interface AssembleSessionLifecycleDeps {
  sessions: SessionLifecycleServiceDeps["sessions"];
  lifecycle: SessionLifecycleServiceDeps["lifecycle"];
  clock?: SessionLifecycleServiceDeps["clock"];
  trashRetentionDays?: number;
  search?: SessionLifecycleServiceDeps["search"];
  extraction?: SessionLifecycleServiceDeps["extraction"];
  /** Read-only external-channel projection (contexts/ store, never mutated). */
  listExternal?: () => ExternalManagedCandidate[];
  /** True for opaque external-channel session ids (read-only, never located locally). */
  isExternalSession?: (conversationId: string) => boolean;
  /** Explicit probe wins; otherwise one is built from `busyReaders`. */
  isBusy?: (conversationId: string) => boolean;
  busyReaders?: SessionBusyReaders;
}

const falsyReaders: Required<SessionBusyReaders> = {
  listRunningSessionIds: () => [],
  listPendingApprovalSessionIds: () => [],
  hasNonterminalLinkedTask: () => false
};

/**
 * Builds the shared busy probe from controllable readers. Every reader is
 * best-effort: a throwing reader degrades to "not busy from this signal"
 * rather than failing the lifecycle mutation, so a monitoring failure can
 * never wedge archive/delete into a 500.
 */
export function createSessionBusyProbe(readers: SessionBusyReaders = {}): (conversationId: string) => boolean {
  const running = readers.listRunningSessionIds ?? falsyReaders.listRunningSessionIds;
  const approvals = readers.listPendingApprovalSessionIds ?? falsyReaders.listPendingApprovalSessionIds;
  const linked = readers.hasNonterminalLinkedTask ?? falsyReaders.hasNonterminalLinkedTask;
  return (conversationId: string): boolean => {
    const id = String(conversationId ?? "").trim();
    if (!id) return false;
    try {
      if (running().includes(id)) return true;
    } catch { /* monitoring must not wedge mutations */ }
    try {
      if (approvals().includes(id)) return true;
    } catch { /* monitoring must not wedge mutations */ }
    try {
      if (linked(id)) return true;
    } catch { /* monitoring must not wedge mutations */ }
    return false;
  };
}

/**
 * Production assembly for the shared Session lifecycle service. The runtime
 * and the tests both enter through here: the runtime passes real stores plus
 * real busy readers and the read-only external projection, while tests pass
 * temporary stores plus controlled readers. Either way the observable
 * contract is the same — busy targets skip archive/delete, external
 * sessions stay read-only, and authorization is rechecked per operation.
 */
export function assembleSessionLifecycle(deps: AssembleSessionLifecycleDeps): SessionLifecycleService {
  return new SessionLifecycleService({
    sessions: deps.sessions,
    lifecycle: deps.lifecycle,
    clock: deps.clock,
    trashRetentionDays: deps.trashRetentionDays,
    search: deps.search,
    extraction: deps.extraction,
    listExternal: deps.listExternal,
    isExternalSession: deps.isExternalSession,
    isBusy: deps.isBusy ?? createSessionBusyProbe(deps.busyReaders ?? {})
  });
}
