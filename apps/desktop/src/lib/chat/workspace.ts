export type ChatWorkspacePane = "chat" | "automations" | "skills";

export function shouldReuseFreshSession(input: {
  activeSessionId: string;
  messageCount: number;
  sending: boolean;
  hasStreamingContent: boolean;
}): boolean {
  return Boolean(input.activeSessionId)
    && input.messageCount === 0
    && !input.sending
    && !input.hasStreamingContent;
}

