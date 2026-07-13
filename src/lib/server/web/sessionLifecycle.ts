import { getRuntime } from "$lib/server/app/runtime.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import { getWebRuntimeContext } from "$lib/server/web/runtimeContext.js";

export type WebSessionDeletionResult = "deleted" | "not_found" | "running";

interface WebSessionLifecycleContext {
  store: Pick<MomRuntimeStore, "deleteSessionArtifacts">;
  pool: {
    get(chatId: string, sessionId: string): { isRunning(): boolean };
    reset(chatId: string, sessionId: string): void;
  };
}

interface WebSessionLifecycleDependencies {
  sessions: Pick<SessionStore, "getWebConversationOwner" | "getConversationById" | "deleteConversation">;
  getContext(profileId: string): WebSessionLifecycleContext;
}

function profileIdFromOwner(externalUserId: string): string {
  const parts = externalUserId.split(":");
  return parts[0] === "web" && parts.length >= 3 ? parts[1] : "default";
}

/** Shared upper-layer lifecycle for both Web and Desktop delete entrypoints. */
export function deleteWebSessionWith(
  dependencies: WebSessionLifecycleDependencies,
  input: { conversationId: string; expectedExternalUserId?: string }
): WebSessionDeletionResult {
  const conversationId = String(input.conversationId ?? "").trim();
  const owner = dependencies.sessions.getWebConversationOwner(conversationId);
  if (!owner || (input.expectedExternalUserId && owner !== input.expectedExternalUserId)) {
    return "not_found";
  }
  if (!dependencies.sessions.getConversationById(conversationId, "web", owner)) {
    return "not_found";
  }

  const { store, pool } = dependencies.getContext(profileIdFromOwner(owner));
  const runner = pool.get(owner, conversationId);
  if (runner.isRunning()) return "running";

  // Delete model-facing state first. If the UI file removal fails, a retry can
  // still find the UI Session and finish; the reverse order would orphan Agent
  // context behind an already-missing UI Session.
  store.deleteSessionArtifacts(owner, conversationId);
  const deleted = dependencies.sessions.deleteConversation(conversationId, "web", owner);
  if (!deleted) return "not_found";
  pool.reset(owner, conversationId);
  return "deleted";
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
