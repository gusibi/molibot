export type ChatWorkspacePane = "chat" | "automations" | "skills" | "agents";

export function openWorkspacePaneState(pane: Exclude<ChatWorkspacePane, "chat">): {
  workspacePane: Exclude<ChatWorkspacePane, "chat">;
  projectPaneActive: false;
  searchOpen: false;
  filePanelOpen: false;
} {
  return { workspacePane: pane, projectPaneActive: false, searchOpen: false, filePanelOpen: false };
}

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
