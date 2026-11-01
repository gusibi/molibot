import { decodeExternalSessionId, readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { ManagedSessionFilters, ManagedSessionResult } from "$lib/server/sessions/sessionQueryService.js";
import type { MemoryExtractionServiceDeps } from "./memoryExtraction.js";

/** Metadata pagination stays separate from transcript reads; daily catch-up also includes archives. */
export function memoryExtractionSources(
  query: (filters: ManagedSessionFilters) => ManagedSessionResult,
  sessions: Pick<SessionStore, "listMessages">,
  dataRoot: string,
  shareOwner: (agentId: string | undefined) => boolean = () => true
): Pick<MemoryExtractionServiceDeps, "listSessions" | "listMessages"> {
  return {
    listSessions: ({ limit, offset, mode }) => {
      const active = query({ state: "active", limit, offset });
      const archived = mode === "daily"
        ? query({ state: "archived", limit: Math.max(1, limit - active.items.length), offset: Math.max(0, offset - active.total) })
        : null;
      const items = [...active.items, ...(archived && active.items.length < limit ? archived.items : [])];
      return {
        total: active.total + (archived?.total ?? 0),
        items: items.map((item) => {
          const ref = item.source === "external" ? decodeExternalSessionId(item.conversationId) : null;
          return { ...item, ownerExternalUserId: ref?.chatId ?? item.ownerExternalUserId, shareOwner: shareOwner(item.agentId) };
        })
      };
    },
    listMessages: (id) => decodeExternalSessionId(id)
      ? readExternalTranscriptFromContexts(dataRoot, id)?.messages ?? []
      : sessions.listMessages(id)
  };
}
