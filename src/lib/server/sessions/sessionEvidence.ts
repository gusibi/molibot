import type { SessionStore } from "$lib/server/sessions/store.js";

export type SessionEvidence =
  | {
      status: "available";
      conversationId: string;
      conversationMessageId?: string;
      role?: string;
      snippet?: string;
      createdAt?: string;
    }
  | {
      status: "source-unavailable";
      conversationId: string;
      conversationMessageId?: string;
    };

/**
 * Shared contract for linked memory and evidence views: resolves a saved
 * source reference (`sessionId` + `conversationMessageId` as stored on
 * memory candidates, traces and write receipts) against the live Session
 * store. A purged (or otherwise missing) source yields an explicit
 * `source-unavailable` payload — views render that state instead of
 * crashing or implying the saved memory itself has failed. Never throws.
 */
export function resolveSessionEvidence(
  sessions: Pick<SessionStore, "listMessageMetadata">,
  conversationId: string,
  conversationMessageId?: string
): SessionEvidence {
  try {
    const id = String(conversationId ?? "").trim();
    if (!id) return { status: "source-unavailable", conversationId: String(conversationId ?? "") };
    const messageId = conversationMessageId == null || String(conversationMessageId).trim() === ""
      ? undefined
      : String(conversationMessageId);
    const messages = sessions.listMessageMetadata(id);
    if (messageId === undefined) {
      return messages.length > 0
        ? { status: "available", conversationId: id }
        : { status: "source-unavailable", conversationId: id };
    }
    const found = messages.find((message) => message.id === messageId);
    if (!found) return { status: "source-unavailable", conversationId: id, conversationMessageId: messageId };
    const content = typeof found.content === "string" ? found.content : "";
    return {
      status: "available",
      conversationId: id,
      conversationMessageId: messageId,
      role: found.role,
      snippet: content.length > 360 ? `${content.slice(0, 357)}...` : content || undefined,
      createdAt: found.createdAt
    };
  } catch {
    return {
      status: "source-unavailable",
      conversationId: String(conversationId ?? ""),
      conversationMessageId: conversationMessageId == null ? undefined : String(conversationMessageId)
    };
  }
}
