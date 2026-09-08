import { getRuntime } from "$lib/server/app/runtime.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import {
  getSessionLifecycleStore,
  type SessionLifecycleStore
} from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { getWebRuntimeContext } from "$lib/server/web/runtimeContext.js";

export type WebSessionDeletionResult = "deleted" | "not_found" | "running" | "protected";

interface WebSessionLifecycleDependencies {
  sessions: SessionStore;
  lifecycle?: SessionLifecycleStore;
  /** Running work, queued work, pending approvals or nonterminal linked tasks refuse deletion. */
  isBusy?: (conversationId: string) => boolean;
  getContext?: (profileId: string) => {
    pool: {
      get(chatId: string, sessionId: string): { isRunning(): boolean };
    };
  };
}

function profileIdFromOwner(externalUserId: string): string {
  const parts = externalUserId.split(":");
  return parts[0] === "web" && parts.length >= 3 ? parts[1] : "default";
}

/**
 * Shared upper-layer lifecycle for Web/Desktop delete entrypoints.
 *
 * Recoverable deletion: the session moves to trash for a fixed recovery
 * period instead of being hard-deleted. The transcript and Agent Context stay
 * in place for full restore; only the search projection is removed
 * immediately. Expiry purge is a separate shared-service operation, not part
 * of this entrypoint.
 */
export function deleteWebSessionWith(
  dependencies: WebSessionLifecycleDependencies,
  input: { conversationId: string; expectedExternalUserId?: string }
): WebSessionDeletionResult {
  const conversationId = String(input.conversationId ?? "").trim();
  if (!conversationId) return "not_found";
  const owner = dependencies.sessions.getWebConversationOwner(conversationId);
  if (!owner || (input.expectedExternalUserId && owner !== input.expectedExternalUserId)) {
    return "not_found";
  }

  const isBusy =
    dependencies.isBusy ??
    ((id: string) => {
      const getContext = dependencies.getContext ?? getWebRuntimeContext;
      return getContext(profileIdFromOwner(owner)).pool.get(owner, id).isRunning();
    });
  const service = new SessionLifecycleService({
    sessions: dependencies.sessions,
    lifecycle: dependencies.lifecycle ?? getSessionLifecycleStore(),
    isBusy
  });
  const outcome = service.trash({
    conversationId,
    requesterExternalUserId: input.expectedExternalUserId ?? owner
  });
  if (outcome.status === "succeeded") return "deleted";
  if (outcome.status === "skipped" && outcome.reason === "busy") return "running";
  if (outcome.status === "skipped" && outcome.reason === "protected") return "protected";
  return "not_found";
}

export function deleteWebSession(input: {
  conversationId: string;
  expectedExternalUserId?: string;
}): WebSessionDeletionResult {
  return deleteWebSessionWith(
    {
      sessions: getRuntime().sessions,
      getContext: getWebRuntimeContext
    },
    input
  );
}
