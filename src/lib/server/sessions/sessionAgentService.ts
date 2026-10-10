import type { RuntimeSettings, AgentSettings } from "$lib/server/settings/schema.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { Conversation } from "$lib/shared/types/message.js";

export function requireEnabledAgent(settings: RuntimeSettings, agentId: string): AgentSettings {
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
  const agentId = input.agentId ?? (input.conversationId ? existing?.agentId : settings.channels.web?.instances.find(item => item.id === input.profileId)?.agentId);
  if (!agentId) throw new Error("Session is unassigned; claim it before continuing");
  return admitAgentConversation(sessions, settings, { ...input, agentId });
}

/** Shared admission for transports with an Agent Context store. */
export function admitStoredAgentSession(
  store: Pick<import("$lib/server/agent/session/store.js").MomRuntimeStore, "readSessionOrigin" | "readLatestRuntimeEvent" | "loadContext" | "createSession" | "markSessionOrigin">,
  settings: RuntimeSettings,
  input: { chatId: string; sessionId: string; explicit: boolean; agentId: string; recoveryRunId?: string; userId?: string; automation?: boolean }
): string {
  let sessionId = input.sessionId;
  const pinned = store.readSessionOrigin(input.chatId, sessionId)?.agentId;
  const suspension = input.recoveryRunId ? store.readLatestRuntimeEvent(input.chatId, "PI_APPROVAL_SUSPENDED", sessionId)?.details : undefined;
  const resuming = Boolean(pinned && input.recoveryRunId && suspension && suspension.runId === input.recoveryRunId && suspension.userId === input.userId);
  if (resuming) {
    if (!settings.agents.some(agent => agent.id === pinned)) throw new Error(`Agent not found: ${pinned}`);
    return sessionId;
  }
  const admittedAgentId = input.explicit && pinned ? pinned : input.agentId;
  requireEnabledAgent(settings, admittedAgentId);
  if (input.explicit && !pinned && store.loadContext(input.chatId, sessionId).length) throw new Error("Session is unassigned; claim it before continuing");
  if (!input.explicit && pinned !== admittedAgentId) sessionId = store.createSession(input.chatId);
  store.markSessionOrigin(input.chatId, sessionId, { agentId: admittedAgentId, ...(input.automation ? { origin: "automation" } : {}) });
  return sessionId;
}

/** Directory ownership supplies the configured Bot identity for unassigned history. */
export function configuredSessionAgent(settings: RuntimeSettings, channel: string, botId: string): string | undefined {
  const agentId = settings.channels[channel]?.instances.find(instance => instance.id === botId)?.agentId;
  return agentId && settings.agents.some(agent => agent.id === agentId) && !settings.deletedAgentIds.includes(agentId) ? agentId : undefined;
}
