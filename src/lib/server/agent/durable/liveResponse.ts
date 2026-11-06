import type { ConversationMessage } from "$lib/shared/types/message.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";

export type LiveConversationMessage = ConversationMessage & { thinking?: string };
const listeners = new Map<string, Set<(message: LiveConversationMessage) => void>>();

function key(sessionId: string): string { return JSON.stringify([storagePaths.dataDir, sessionId]); }

/** Transport subscriptions observe execution; detaching never cancels the work. */
export function subscribeLiveConversation(sessionId: string, listener: (message: LiveConversationMessage) => void): () => void {
  const id = key(sessionId);
  const group = listeners.get(id) ?? new Set();
  group.add(listener);
  listeners.set(id, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(id); };
}

export function publishLiveConversation(message: LiveConversationMessage): void {
  for (const listener of listeners.get(key(message.conversationId)) ?? []) {
    try { listener(message); } catch { /* A disconnected observer cannot fail execution. */ }
  }
}
