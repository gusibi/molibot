import { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import { projectDurableConversationPlan } from "$lib/server/agent/durable/planProjection.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import {
  projectConversationMessages,
  type ConversationProjection,
  type ProjectedConversationMessage
} from "$lib/server/app/conversationProjection.js";
import { getRuntimeContextForConversation, resolveRunnerChatId, resolveWebConversationIdentity } from "$lib/server/web/runtimeContext.js";
import { getMemoryTraceStore } from "$lib/server/memory/traceStore.js";

interface ProjectionRuntime {
  sessions: SessionStore;
}

/**
 * Entries-file byte ceiling for transcript reads (see
 * `listSessionMessageEntries`). 16 MB of newest entries is far beyond any
 * rendered transcript while keeping the synchronous parse in the tens-of-ms.
 */
const PROJECTION_TAIL_BYTES_CAP = 16 * 1024 * 1024;

let runtimeProvider: (() => ProjectionRuntime) | undefined;

export function configureConversationProjectionRuntime(provider: () => ProjectionRuntime): void {
  runtimeProvider = provider;
}

function projectionRuntime(): ProjectionRuntime {
  if (!runtimeProvider) throw new Error("Conversation projection runtime is not configured");
  return runtimeProvider();
}

function projectionContext(input: { profileId: string; userId?: string; conversationId: string }) {
  const identity = resolveWebConversationIdentity(input);
  const runtime = projectionRuntime();
  const { store, pool } = getRuntimeContextForConversation(identity.profileId, input.conversationId);
  return {
    runtime,
    store,
    pool,
    chatId: resolveRunnerChatId(input.conversationId, identity.externalUserId),
    profileId: identity.profileId
  };
}

export function loadConversationProjection(input: {
  profileId: string;
  userId?: string;
  conversationId: string;
}): ConversationProjection {
  const { runtime, store, pool, chatId } = projectionContext(input);
  const result = projectConversationMessages({
    conversationId: input.conversationId,
    // Display read: bound the synchronous parse of a long session's entries
    // file so one huge transcript cannot pin the event loop for seconds
    // ("click a session, the whole app freezes"). Fork/compaction paths keep
    // reading the full history.
    entries: store.listSessionMessageEntries(chatId, input.conversationId, {
      tailBytesCap: PROJECTION_TAIL_BYTES_CAP
    }),
    metadata: runtime.sessions.listMessageMetadata(input.conversationId)
  });
  runtime.sessions.markMessagesContextBacked(input.conversationId, result.migratedMetadataIds);
  runtime.sessions.recordMessageSourceEntries(input.conversationId, result.resolvedSourceEntries);
  try {
    const sourceEntryIds = result.messages
      .filter((message) => message.role === "assistant")
      .map((message) => result.sourceEntryByMessageId.get(message.id))
      .filter((value): value is string => Boolean(value));
    const traceMeta = getMemoryTraceStore().getMetaBySourceEntryIds(sourceEntryIds);
    for (const message of result.messages) {
      const sourceEntryId = result.sourceEntryByMessageId.get(message.id);
      if (sourceEntryId && traceMeta[sourceEntryId]) message.memoryTrace = traceMeta[sourceEntryId];
    }
  } catch {
    // Memory observability must never prevent conversation history from loading.
  }
  for (const message of result.messages) {
    if (!message.plan) continue;
    if (message.plan.durableExecutionId) {
      try {
        const detail = new DurableExecutionCoordinator().inspect("owner", message.plan.durableExecutionId);
        if (detail.execution.sourceUiSessionId === input.conversationId) message.plan = projectDurableConversationPlan(message.plan, detail);
      } catch {
        message.plan = { ...message.plan, status: "blocked" };
      }
    } else if (message.plan.status === "executing" && !pool.snapshotRunning().some((run) => run.chatId === chatId && run.sessionId === input.conversationId)) {
      message.plan = runtime.sessions.updateConversationPlan(input.conversationId, message.plan.id, (plan) => ({ ...plan, status: "paused", updatedAt: new Date().toISOString() })) ?? message.plan;
    }
    message.steps = message.steps?.map((step) => step.kind === "plan" && step.plan.id === message.plan?.id ? { ...step, plan: message.plan } : step);
  }
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
  const identity = resolveWebConversationIdentity({ profileId: "default", conversationId });
  return loadConversationMessages({
    profileId: identity.profileId,
    userId: identity.userId,
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
