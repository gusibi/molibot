import type { SessionStore } from "$lib/server/sessions/store.js";
import {
  projectConversationMessages,
  type ConversationProjection,
  type ProjectedConversationMessage
} from "$lib/server/app/conversationProjection.js";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity.js";
import { getRuntimeContextForConversation, resolveRunnerChatId } from "$lib/server/web/runtimeContext.js";

interface ProjectionRuntime {
  sessions: SessionStore;
}

let runtimeProvider: (() => ProjectionRuntime) | undefined;

export function configureConversationProjectionRuntime(provider: () => ProjectionRuntime): void {
  runtimeProvider = provider;
}

function projectionRuntime(): ProjectionRuntime {
  if (!runtimeProvider) throw new Error("Conversation projection runtime is not configured");
  return runtimeProvider();
}

function projectionContext(input: { profileId: string; userId?: string; conversationId: string }) {
  const profileId = sanitizeWebProfileId(input.profileId);
  const userId = sanitizeWebUserId(input.userId);
  const runtime = projectionRuntime();
  const projectId = runtime.sessions.getConversationProjectId(input.conversationId);
  const projectConversation = projectId
    ? runtime.sessions.getProjectConversation(projectId, input.conversationId)
    : null;
  const fallback = projectConversation?.externalUserId || toWebExternalUserId(userId, profileId);
  const { store } = getRuntimeContextForConversation(profileId, input.conversationId);
  return {
    runtime,
    store,
    chatId: resolveRunnerChatId(input.conversationId, fallback),
    profileId
  };
}

export function loadConversationProjection(input: {
  profileId: string;
  userId?: string;
  conversationId: string;
}): ConversationProjection {
  const { runtime, store, chatId } = projectionContext(input);
  const result = projectConversationMessages({
    conversationId: input.conversationId,
    entries: store.listSessionMessageEntries(chatId, input.conversationId),
    metadata: runtime.sessions.listMessageMetadata(input.conversationId)
  });
  runtime.sessions.markMessagesContextBacked(input.conversationId, result.migratedMetadataIds);
  return result;
}

export function loadConversationMessages(input: {
  profileId: string;
  userId?: string;
  conversationId: string;
}): ProjectedConversationMessage[] {
  return loadConversationProjection(input).messages;
}

export function loadStoredConversationMessages(conversationId: string): ProjectedConversationMessage[] {
  const sessions = projectionRuntime().sessions;
  const projectId = sessions.getConversationProjectId(conversationId);
  if (projectId) {
    return loadConversationMessages({ profileId: "default", conversationId });
  }
  const externalUserId = sessions.getWebConversationOwner(conversationId) ?? "";
  const match = externalUserId.match(/^web:([^:]+):(.*)$/);
  return loadConversationMessages({
    profileId: match?.[1] || "default",
    userId: match?.[2] || "web-anonymous",
    conversationId
  });
}

/** Truncates both the Agent entry log and its UI metadata projection. */
export function truncateConversationProjection(input: {
  profileId: string;
  userId?: string;
  conversationId: string;
  fromMessageId: string;
}): number {
  const context = projectionContext(input);
  const projection = loadConversationProjection(input);
  const index = projection.messages.findIndex((message) => message.id === input.fromMessageId);
  if (index < 0) {
    const error = new Error(`Message not found (session has ${projection.messages.length} message${projection.messages.length === 1 ? "" : "s"})`);
    (error as Error & { code?: string }).code = "MESSAGE_NOT_FOUND";
    throw error;
  }
  const sourceEntryId = projection.messages
    .slice(index)
    .map((message) => projection.sourceEntryByMessageId.get(message.id))
    .find(Boolean);
  if (sourceEntryId) {
    context.store.truncateSessionFromEntry(context.chatId, input.conversationId, sourceEntryId);
  }
  return context.runtime.sessions.truncateMessagesFrom(input.conversationId, input.fromMessageId);
}
