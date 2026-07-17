import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { decodeExternalSessionId, listExternalSessionsFromContexts, readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts.js";
import { listAuthorizedConversationSources, isAuthorizedConversationSource, type ConversationAuthorizationScope } from "$lib/server/sessions/conversationAuthorization.js";
import type { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";

const schema = Type.Object({
  query: Type.String({ minLength: 1 }),
  from: Type.Optional(Type.String({ description: "Inclusive ISO timestamp/date" })),
  to: Type.Optional(Type.String({ description: "Inclusive ISO timestamp/date" })),
  channel: Type.Optional(Type.String()),
  projectId: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 }))
});

export function syncAuthorizedExternalConversationIndex(options: {
  index: ConversationSearchIndex;
  dataRoot: string;
  scope: ConversationAuthorizationScope;
}): number {
  const authorized = listAuthorizedConversationSources(options.scope);
  let indexed = 0;
  for (const entry of listExternalSessionsFromContexts(options.dataRoot)) {
    const ref = decodeExternalSessionId(entry.conversation.id);
    if (!ref) continue;
    const source = { botId: ref.botId, channel: ref.channel, chatId: ref.chatId, purpose: "chat" } as const;
    if (!authorized.some((item) => isAuthorizedConversationSource(item, source))) continue;
    const transcript = readExternalTranscriptFromContexts(options.dataRoot, entry.conversation.id);
    if (!transcript) continue;
    const sourceKey = `${ref.channel}:${ref.botId}:${ref.chatId}:${ref.sessionId}`;
    const current = new Set<string>();
    for (const message of transcript.messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      current.add(message.id);
      options.index.enqueueUpsert({
        messageId: message.id,
        conversationId: entry.conversation.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        botId: ref.botId,
        channel: ref.channel,
        chatId: ref.chatId,
        purpose: "chat",
        sourceKey
      });
      indexed += 1;
    }
    options.index.reconcile(sourceKey, current);
  }
  return indexed;
}

export function createConversationSearchTool(options: {
  index: ConversationSearchIndex;
  scope: ConversationAuthorizationScope;
  externalDataRoot?: string;
}): AgentTool<typeof schema> {
  return {
    name: "conversation_search",
    label: "conversation_search",
    description: "Search authorized prior conversation text and return message ids that the UI can jump to. Never searches system prompts, tool results, internal events, automation runs, other bots or unauthorized projects.",
    parameters: schema,
    execute: async (_toolCallId, params) => {
      if (options.externalDataRoot) {
        syncAuthorizedExternalConversationIndex({ index: options.index, dataRoot: options.externalDataRoot, scope: options.scope });
      }
      const hits = options.index.search({
        query: params.query,
        from: params.from,
        to: params.to,
        channel: params.channel,
        projectId: params.projectId,
        limit: params.limit,
        authorizedSources: listAuthorizedConversationSources(options.scope)
      });
      return {
        content: [{
          type: "text",
          text: hits.length === 0
            ? "(no authorized conversation matches)"
            : hits.map((hit) => `[${hit.createdAt}] ${hit.role}: ${hit.snippet}\nconversationId=${hit.conversationId} conversationMessageId=${hit.conversationMessageId}`).join("\n\n")
        }],
        details: { hits }
      };
    }
  };
}
