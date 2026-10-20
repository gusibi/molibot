import type { RuntimeSettings, AgentSettings } from "$lib/server/settings/schema.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { Conversation } from "$lib/shared/types/message.js";
import { resolveExecutionIdentity } from "./executionIdentity.js";

export function requireEnabledAgent(settings: RuntimeSettings, agentId: string): AgentSettings {
  if (settings.pendingAgentDeletions?.includes(agentId)) throw new Error(`Agent is being deleted: ${agentId}`);
  const agent = settings.agents.find((item) => item.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  if (!agent.enabled) throw new Error(`Agent disabled: ${agentId}`);
  return agent;
}

/** Resolves ordinary execution from persisted ownership. */
export function admitAgentConversation(
  sessions: SessionStore,
  settings: RuntimeSettings,
  input: { externalUserId: string; conversationId?: string; agentId: string }
): Conversation {
  requireEnabledAgent(settings, input.agentId);
  if (!input.conversationId) return sessions.createWebConversation(input.externalUserId, undefined, input.agentId);
  const conversation = sessions.getConversationById(input.conversationId, "web", input.externalUserId);
  if (!conversation || conversation.projectId) throw new Error("Ordinary Session not found");
  if (!conversation.agentId) throw new Error("Session is unassigned; claim it before continuing");
  if (conversation.agentId !== input.agentId) throw new Error("Session Agent mismatch");
  return sessions.getOrCreateConversation("web", input.externalUserId, conversation.id, { agentId: input.agentId });
}

export function claimAgentConversation(
  sessions: SessionStore,
  settings: RuntimeSettings,
  input: { externalUserId: string; conversationId: string; agentId: string }
): Conversation {
  requireEnabledAgent(settings, input.agentId);
  const claimed = sessions.claimConversationAgent(input.conversationId, input.externalUserId, input.agentId);
  if (!claimed) throw new Error("Ordinary Session not found");
  return claimed;
}

export function resolveOrdinaryWebConversation(
  sessions: SessionStore,
  settings: RuntimeSettings,
  input: { externalUserId: string; profileId: string; conversationId?: string; agentId?: string }
): Conversation {
  const existing = input.conversationId ? sessions.getConversationById(input.conversationId, "web", input.externalUserId) : null;
  if (existing?.projectId) return sessions.getOrCreateConversation("web", input.externalUserId, existing.id, { projectId: existing.projectId });
  const identity = resolveExecutionIdentity(settings, {
    channel: "web",
    botId: input.profileId,
    assertedAgentId: input.agentId,
    persistedAgentId: existing?.agentId,
    explicitTarget: Boolean(input.conversationId),
    hasContext: Boolean(existing)
  });
  return admitAgentConversation(sessions, settings, { ...input, agentId: identity.agentId });
}

/** A suspended approval only belongs to this run when run and user both match. */
export function matchesSuspendedRun(
  details: unknown,
  runId: string | undefined,
  userId: string | undefined
): boolean {
  if (!runId) return false;
  const suspension = details as { runId?: unknown; userId?: unknown } | undefined;
  return suspension?.runId === runId && suspension?.userId === userId;
}

/** Shared admission for transports with an Agent Context store. */
export function admitStoredAgentSession(
  store: Pick<import("$lib/server/agent/session/store.js").MomRuntimeStore, "readSessionOrigin" | "readLatestRuntimeEvent" | "loadContext" | "createSession" | "markSessionOrigin">,
  settings: RuntimeSettings,
  input: { chatId: string; sessionId: string; explicit: boolean; agentId: string; recoveryRunId?: string; userId?: string; automation?: boolean }
): string {
  const pinned = store.readSessionOrigin(input.chatId, input.sessionId)?.agentId;
  const suspension = input.recoveryRunId ? store.readLatestRuntimeEvent(input.chatId, "PI_APPROVAL_SUSPENDED", input.sessionId)?.details : undefined;
  const recoveryMatches = Boolean(pinned && matchesSuspendedRun(suspension, input.recoveryRunId, input.userId));
  const hasContext = Boolean(!pinned && input.explicit && store.loadContext(input.chatId, input.sessionId).length);
  const identity = resolveExecutionIdentity(settings, {
    targetAgentId: input.agentId,
    persistedAgentId: pinned,
    explicitTarget: input.explicit,
    hasContext,
    recoveryMatches
  });
  if (identity.mode === "recovery") return input.sessionId;
  requireEnabledAgent(settings, identity.agentId);
  const sessionId = identity.action === "create" ? store.createSession(input.chatId) : input.sessionId;
  store.markSessionOrigin(input.chatId, sessionId, { agentId: identity.agentId, ...(input.automation ? { origin: "automation" } : {}) });
  return sessionId;
}
