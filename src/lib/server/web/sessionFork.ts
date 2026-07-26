import { createHash } from "node:crypto";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { Conversation } from "$lib/shared/types/message.js";
import { projectConversationMessages } from "$lib/server/app/conversationProjection.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity.js";
import { getRuntimeContextForConversation, resolveRunnerChatId } from "$lib/server/web/runtimeContext.js";

export type SessionForkResult =
  | { status: "created" | "existing"; conversation: Conversation }
  | { status: "not_found" | "running" | "message_not_found" | "invalid_fork_point" };

interface ForkPool {
  get(chatId: string, sessionId: string): { isRunning(): boolean };
  reset(chatId: string, sessionId: string): void;
}

interface SessionForkDependencies {
  sessions: Pick<SessionStore,
    | "getForkableConversation"
    | "listMessageMetadata"
    | "markMessagesContextBacked"
    | "recordMessageSourceEntries"
    | "forkConversationBeforeMessage"
  >;
  store: Pick<MomRuntimeStore,
    | "listSessionMessageEntries"
    | "forkSessionBeforeEntry"
    | "deleteSessionArtifacts"
  >;
  pool: ForkPool;
}

export function sessionForkId(sourceSessionId: string, fromMessageId: string, requestId: string): string {
  const digest = createHash("sha256")
    .update(`${sourceSessionId}\0${fromMessageId}\0${requestId}`)
    .digest("hex")
    .slice(0, 24);
  return `fork-${digest}`;
}

/** Shared cross-store coordinator. Agent state is written first; if the visible
 * Session write fails, its artifacts are compensated immediately. */
export function forkSessionWith(
  dependencies: SessionForkDependencies,
  input: {
    owner: string;
    chatId: string;
    sourceSessionId: string;
    fromMessageId: string;
    childSessionId: string;
  }
): SessionForkResult {
  const source = dependencies.sessions.getForkableConversation(input.sourceSessionId, input.owner);
  if (!source) return { status: "not_found" };

  const existing = dependencies.sessions.getForkableConversation(input.childSessionId, input.owner)?.conversation;
  if (existing) {
    return existing.parentSessionId === input.sourceSessionId && existing.forkedFromMessageId === input.fromMessageId
      ? { status: "existing", conversation: existing }
      : { status: "not_found" };
  }

  if (dependencies.pool.get(input.chatId, input.sourceSessionId).isRunning()) {
    return { status: "running" };
  }

  const metadata = dependencies.sessions.listMessageMetadata(input.sourceSessionId);
  const projection = projectConversationMessages({
    conversationId: input.sourceSessionId,
    entries: dependencies.store.listSessionMessageEntries(input.chatId, input.sourceSessionId),
    metadata
  });
  dependencies.sessions.markMessagesContextBacked(input.sourceSessionId, projection.migratedMetadataIds);
  dependencies.sessions.recordMessageSourceEntries(input.sourceSessionId, projection.resolvedSourceEntries);

  const message = projection.messages.find((item) => item.id === input.fromMessageId);
  if (!message) return { status: "message_not_found" };
  if (message.role !== "user") return { status: "invalid_fork_point" };
  const fromEntryId = projection.sourceEntryByMessageId.get(message.id);
  if (!fromEntryId) return { status: "message_not_found" };

  dependencies.store.forkSessionBeforeEntry(
    input.chatId,
    input.sourceSessionId,
    fromEntryId,
    input.childSessionId
  );
  try {
    const conversation = dependencies.sessions.forkConversationBeforeMessage(
      input.sourceSessionId,
      input.fromMessageId,
      input.childSessionId
    );
    dependencies.pool.reset(input.chatId, input.childSessionId);
    return { status: "created", conversation };
  } catch (error) {
    // Another process may have completed the same deterministic fork after our
    // initial existence check. That is idempotent success; deleting the shared
    // Agent child here would corrupt the now-visible Session.
    if ((error as Error & { code?: string }).code === "SESSION_EXISTS") {
      const existing = dependencies.sessions.getForkableConversation(input.childSessionId, input.owner)?.conversation;
      if (existing?.parentSessionId === input.sourceSessionId && existing.forkedFromMessageId === input.fromMessageId) {
        dependencies.pool.reset(input.chatId, input.childSessionId);
        return { status: "existing", conversation: existing };
      }
    }
    dependencies.store.deleteSessionArtifacts(input.chatId, input.childSessionId);
    throw error;
  }
}

/**
 * Forks a Web *or* Project Session. The runtime lookups below were already
 * project-aware (`getRuntimeContextForConversation` picks the project pool and
 * `resolveRunnerChatId` keys off the conversation's own externalUserId); only
 * the source lookup was Web-only, which is why Project Chat had to keep using
 * the destructive edit endpoint.
 */
export function forkSession(input: {
  profileId: string;
  userId?: string;
  sourceSessionId: string;
  fromMessageId: string;
  requestId: string;
}): SessionForkResult {
  const profileId = sanitizeWebProfileId(input.profileId);
  const userId = sanitizeWebUserId(input.userId);
  const owner = toWebExternalUserId(userId, profileId);
  const { store, pool } = getRuntimeContextForConversation(profileId, input.sourceSessionId);
  return forkSessionWith(
    { sessions: getRuntime().sessions, store, pool },
    {
      owner,
      chatId: resolveRunnerChatId(input.sourceSessionId, owner),
      sourceSessionId: input.sourceSessionId,
      fromMessageId: input.fromMessageId,
      childSessionId: sessionForkId(input.sourceSessionId, input.fromMessageId, input.requestId)
    }
  );
}
