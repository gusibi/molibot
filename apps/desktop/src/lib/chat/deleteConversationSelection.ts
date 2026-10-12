import { executeDesktopManagedBulk } from "../api";

/** Deletes only the explicit selection through the shared recoverable lifecycle. */
export async function deleteConversationSelection(endpoint: string, sessionIds: string[]): Promise<{deletedIds: string[]; error: string}> {
  const result = await executeDesktopManagedBulk(endpoint, {
    kind: "delete", targets: [...new Set(sessionIds)].map(conversationId => ({conversationId})), idempotencyKey: crypto.randomUUID(),
  });
  return {
    deletedIds: result.items.filter(item => item.status === "succeeded").map(item => item.conversationId),
    error: result.items.filter(item => item.status !== "succeeded").map(item => `${item.conversationId}: ${item.detail || item.reason || item.status}`).join("\n"),
  };
}
