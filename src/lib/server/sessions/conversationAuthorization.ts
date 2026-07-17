import type { Channel } from "$lib/shared/types/message.js";

export interface ConversationAuthorizationScope {
  botId: string;
  channel: string;
  chatId: string;
  projectId?: string;
}

export interface AuthorizedConversationSource {
  botId: string;
  channel: string;
  chatId?: string;
  projectId?: string;
  purpose: "chat" | "project";
}

/**
 * The single authorization projection used by reflection, transcript search and
 * external-session readers. It intentionally never grants automation/internal
 * sources; callers may only narrow this list further.
 */
export function listAuthorizedConversationSources(
  scope: ConversationAuthorizationScope
): AuthorizedConversationSource[] {
  const sources: AuthorizedConversationSource[] = [{
    botId: scope.botId,
    channel: scope.channel,
    chatId: scope.chatId,
    purpose: "chat"
  }];
  if (scope.projectId) {
    sources.push({
      botId: scope.botId,
      channel: scope.channel,
      projectId: scope.projectId,
      purpose: "project"
    });
  }
  return sources;
}

export function isAuthorizedConversationSource(
  source: AuthorizedConversationSource,
  candidate: { botId: string; channel: Channel | string; chatId?: string; projectId?: string; origin?: string; purpose?: string }
): boolean {
  if (candidate.origin?.startsWith("internal:") || candidate.origin === "automation") return false;
  if (candidate.purpose === "automation" || candidate.purpose === "internal") return false;
  if (source.botId !== candidate.botId || source.channel !== candidate.channel) return false;
  if (source.purpose === "project") return Boolean(source.projectId && source.projectId === candidate.projectId);
  return Boolean(source.chatId && source.chatId === candidate.chatId && !candidate.projectId);
}
