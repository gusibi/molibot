import { resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import {
  decodeExternalSessionId,
  listExternalSessionsFromContexts
} from "$lib/server/app/externalSessionsFromContexts.js";
import { snapshotAllRuntimeRuns } from "$lib/server/agent/core/runnerPool.js";
import { getDurableExecutionStore } from "$lib/server/agent/durable/store.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { getConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { getSessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import {
  assembleSessionLifecycle,
  type SessionBusyReaders
} from "$lib/server/sessions/sessionServiceAssembly.js";
import type { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import type { ExternalManagedCandidate } from "$lib/server/sessions/sessionQueryService.js";
import {
  SessionTrashCleanupService,
  type SessionTrashCleanupPorts
} from "$lib/server/sessions/sessionTrashCleanup.js";
import type { SessionExtractionStatusSource } from "$lib/server/sessions/sessionQueryService.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import {
  getProjectRuntimeContext,
  getWebRuntimeContext
} from "$lib/server/web/runtimeContext.js";

/**
 * Production wiring for Session lifecycle maintenance. The Channel layer
 * stays out of cleanup policy: the busy probe, the read-only external
 * projection and the trash purge ports are all assembled here (shared upper
 * layer) and injected into the shared services the runtime owns.
 */

/** Read-only external projection reused for managed listing (US2). */
export function listManagedExternalCandidates(dataRoot: string = resolve(config.dataDir)): ExternalManagedCandidate[] {
  return listExternalSessionsFromContexts(dataRoot).map((entry) => ({
    conversation: entry.conversation,
    botId: decodeExternalSessionId(entry.conversation.id)?.botId ?? "",
    channel: entry.channel
  }));
}

/** True for opaque external-channel session ids (read-only, never mutated). */
export function isExternalSessionId(conversationId: string): boolean {
  return decodeExternalSessionId(String(conversationId ?? "").trim()) !== null;
}

function profileIdFromChatId(chatId: string): string {
  const parts = String(chatId ?? "").split(":");
  return parts[0] === "web" && parts.length >= 3 && parts[1] ? parts[1] : "default";
}

/**
 * Real busy readers: live runner turns (running work, including queued
 * steer/follow-up which only exist on a running turn), pending host-tool
 * approvals (waiting work) and nonterminal linked Durable Executions
 * (queued/running/paused/waiting tasks). Each reader degrades to empty on
 * failure — monitoring must never wedge lifecycle mutations.
 */
export function realSessionBusyReaders(): SessionBusyReaders {
  return {
    listRunningSessionIds: () => {
      try {
        return snapshotAllRuntimeRuns().map((run) => run.sessionId);
      } catch {
        return [];
      }
    },
    listPendingApprovalSessionIds: () => {
      try {
        return getHostBashStore()
          .listPending()
          .map((record) => record.sessionId)
          .filter((value): value is string => Boolean(value));
      } catch {
        return [];
      }
    },
    hasNonterminalLinkedTask: (conversationId: string) => {
      try {
        return getDurableExecutionStore().hasNonterminalForSession(conversationId);
      } catch {
        return false;
      }
    }
  };
}

/**
 * Production assembly for the shared lifecycle service: real stores, the
 * authorized search projection, the read-only external projection and the
 * real busy probe. Tests reach the same service through
 * `assembleSessionLifecycle` with temporary stores and controlled readers.
 */
export function buildProductionSessionLifecycle(input: {
  sessions: SessionStore;
  extraction?: SessionExtractionStatusSource;
  clock?: () => Date;
  dataRoot?: string;
}): SessionLifecycleService {
  return assembleSessionLifecycle({
    sessions: input.sessions,
    lifecycle: getSessionLifecycleStore(),
    clock: input.clock,
    search: { index: getConversationSearchIndex(storagePaths.moryDbFile), botId: "web" },
    extraction: input.extraction,
    listExternal: () => listManagedExternalCandidates(input.dataRoot ?? resolve(config.dataDir)),
    isExternalSession: isExternalSessionId,
    busyReaders: realSessionBusyReaders()
  });
}

/**
 * Real cross-store purge ports. Every step only touches Session-owned data:
 * the UI conversation file, the linked Agent Context files and the
 * conversation search projection. Saved memories, independent documents,
 * Project root files and shared artifacts are never reachable from here.
 */
export function buildSessionTrashPorts(
  sessions: SessionStore,
  lifecycle = getSessionLifecycleStore()
): SessionTrashCleanupPorts {
  return {
    lifecycle,
    deleteUiConversation: (conversationId: string) => {
      const owner = sessions.getWebConversationOwner(conversationId);
      if (owner) {
        sessions.deleteConversation(conversationId, "web", owner);
        return;
      }
      const projectId = sessions.getConversationProjectId(conversationId);
      if (projectId) {
        sessions.deleteProjectConversation(projectId, conversationId);
        return;
      }
      // Unknown ids (already purged): missing counts as success.
    },
    listAgentChatIds: (conversationId: string) => {
      const chats: string[] = [];
      const owner = sessions.getWebConversationOwner(conversationId);
      if (owner) chats.push(owner);
      const projectId = sessions.getConversationProjectId(conversationId);
      if (projectId) {
        const conversation = sessions.getProjectConversation(projectId, conversationId);
        if (conversation?.externalUserId) chats.push(conversation.externalUserId);
      }
      // Unknown ids hold no Agent Context: the agent step stays a no-op.
      return [...new Set(chats)];
    },
    deleteAgentSession: (chatId: string, sessionId: string) => {
      const projectId = sessions.getConversationProjectId(sessionId);
      const store = projectId
        ? getProjectRuntimeContext(projectId).store
        : getWebRuntimeContext(profileIdFromChatId(chatId)).store;
      // Idempotent by design: missing contexts report false, never throw.
      store.deleteSessionArtifacts(chatId, sessionId);
    },
    finalizeSearchConversation: (conversationId: string) => {
      const owner = sessions.getWebConversationOwner(conversationId);
      const conversation = owner
        ? sessions.getConversationById(conversationId, "web", owner)
        : (() => {
          const projectId = sessions.getConversationProjectId(conversationId);
          return projectId ? sessions.getProjectConversation(projectId, conversationId) : null;
        })();
      // The UI file (and its projection with it) is deleted in the next
      // step; an already-gone conversation has no projection left — success.
      if (conversation) sessions.removeConversationSearchProjection(conversation);
    },
    isAuthorized: (conversationId: string, requesterExternalUserId: string) => {
      const owner = sessions.getWebConversationOwner(conversationId);
      // Web conversations belong to exactly one owner; Project conversations
      // are deliberately owner-shared.
      if (owner) return owner === requesterExternalUserId;
      if (sessions.getConversationProjectId(conversationId)) return true;
      return false;
    }
  };
}

/** Production trash cleanup service over the real ports (temp-dir safe in tests via injected sessions). */
export function buildSessionTrashCleanup(
  sessions: SessionStore,
  lifecycle = getSessionLifecycleStore(),
  clock?: () => Date
): SessionTrashCleanupService {
  return new SessionTrashCleanupService({ ...buildSessionTrashPorts(sessions, lifecycle), lifecycle, clock });
}
