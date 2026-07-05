import {
  parseDesktopActivity,
  parseDesktopApproval,
  reduceDesktopActivities,
  sendDesktopChatWithFiles,
  streamDesktopChat,
  type DesktopActivityEntry
} from "../api";
import type { DesktopApprovalPrompt, DesktopThinkingLevel } from "@molibot/desktop-contract";

export interface ConversationTurnHandlers {
  onToken?: (delta: string) => void;
  onReplace?: (text: string) => void;
  onThinking?: (delta: string) => void;
  onStatus?: (text: string) => void;
  onActivities?: (activities: DesktopActivityEntry[]) => void;
  onApproval?: (approval: DesktopApprovalPrompt) => void;
  onDone?: (result: { response: string; thinkingText: string }) => void;
}

export async function runDesktopConversationTurn(input: {
  endpoint: string;
  profileId: string;
  sessionId: string;
  projectId?: string;
  message: string;
  thinkingLevel: DesktopThinkingLevel;
  files?: File[];
  signal?: AbortSignal;
}, handlers: ConversationTurnHandlers = {}): Promise<void> {
  if (input.files?.length) {
    await sendDesktopChatWithFiles(input.endpoint, {
      profileId: input.profileId,
      sessionId: input.sessionId,
      message: input.message,
      thinkingLevel: input.thinkingLevel,
      files: input.files,
      projectId: input.projectId
    }, input.signal);
    return;
  }

  let activities: DesktopActivityEntry[] = [];
  await streamDesktopChat(input.endpoint, {
    profileId: input.profileId,
    sessionId: input.sessionId,
    message: input.message,
    thinkingLevel: input.thinkingLevel,
    projectId: input.projectId
  }, async (event, data) => {
    if (event === "token") handlers.onToken?.(String(data.delta ?? ""));
    if (event === "replace") handlers.onReplace?.(String(data.text ?? ""));
    if (event === "thinking_delta") handlers.onThinking?.(String(data.delta ?? ""));
    if (event === "status" || event === "runner_event") {
      handlers.onStatus?.(String(data.text ?? data.diagnostic ?? ""));
    }
    const activity = parseDesktopActivity(event, data);
    if (activity) {
      activities = reduceDesktopActivities(activities, activity);
      handlers.onActivities?.(activities);
    }
    if (event === "host_bash_approval") {
      const approval = parseDesktopApproval(data);
      if (approval) handlers.onApproval?.(approval);
    }
    if (event === "done") {
      handlers.onDone?.({
        response: String(data.response ?? ""),
        thinkingText: String(data.thinkingText ?? "")
      });
    }
    if (event === "error") throw new Error(String(data.error ?? "Stream failed"));
  }, input.signal);
}
