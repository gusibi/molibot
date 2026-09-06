import {
  parseDesktopActivity,
  parseDesktopApproval,
  reduceDesktopActivities,
  sendDesktopChatWithFiles,
  streamDesktopChat,
  type DesktopActivityEntry
} from "../api";
import type { DesktopApprovalPrompt, DesktopConversationActivity, DesktopConversationPlan, DesktopThinkingLevel } from "@molibot/desktop-contract";
import { classifyComposerSuggestion } from "./composerSuggestionCatalog";

export interface ConversationTurnHandlers {
  onUploadComplete?: () => void;
  onToken?: (delta: string) => void;
  onReplace?: (text: string) => void;
  onThinking?: (delta: string) => void;
  onStatus?: (text: string) => void;
  onActivities?: (activities: DesktopActivityEntry[]) => void;
  onActivity?: (activity: DesktopConversationActivity) => void;
  onPlan?: (plan: DesktopConversationPlan) => void;
  onApproval?: (approval: DesktopApprovalPrompt) => void;
  onTitleUpdated?: (conversationId: string, title: string) => void;
  onDone?: (result: { response: string; thinkingText: string }) => void;
}

export async function runDesktopConversationTurn(input: {
  endpoint: string;
  profileId: string;
  sessionId: string;
  projectId?: string;
  modelKey?: string;
  message: string;
  thinkingLevel: DesktopThinkingLevel;
  files?: File[];
  signal?: AbortSignal;
  resumePlanId?: string;
}, handlers: ConversationTurnHandlers = {}): Promise<void> {
  const invocation = classifyComposerSuggestion(input.message);
  if (invocation?.kind === "command") {
    await sendDesktopChatWithFiles(input.endpoint, {
      profileId: input.profileId,
      sessionId: input.sessionId,
      message: input.message,
      thinkingLevel: input.thinkingLevel,
      files: input.files ?? [],
      projectId: input.projectId,
      modelKey: input.modelKey
    }, input.signal);
    return;
  }

  let activities: DesktopActivityEntry[] = [];
  await streamDesktopChat(input.endpoint, {
    profileId: input.profileId,
    sessionId: input.sessionId,
    message: input.message,
    thinkingLevel: input.thinkingLevel,
    projectId: input.projectId,
    modelKey: input.modelKey,
    files: input.files
    ,resumePlanId: input.resumePlanId
  }, async (event, data) => {
    if (event === "token") handlers.onToken?.(String(data.delta ?? ""));
    if (event === "replace") handlers.onReplace?.(String(data.text ?? ""));
    if (event === "thinking_delta") handlers.onThinking?.(String(data.delta ?? ""));
    if (event === "status") {
      handlers.onStatus?.(String(data.text ?? ""));
    }
    const activity = parseDesktopActivity(event, data);
    if (activity) {
      activities = reduceDesktopActivities(activities, activity);
      handlers.onActivities?.(activities);
      handlers.onActivity?.(activity);
    }
    if (event === "host_bash_approval") {
      const approval = parseDesktopApproval(data);
      if (approval) handlers.onApproval?.(approval);
    }
    if (event === "plan_proposal" || event === "plan_progress") handlers.onPlan?.(data as unknown as DesktopConversationPlan);
    if (event === "session_title_updated") {
      const title = String(data.title ?? "").trim();
      const targetId = String(data.conversationId ?? "").trim();
      if (title && targetId) handlers.onTitleUpdated?.(targetId, title);
    }
    if (event === "done") {
      handlers.onDone?.({
        response: String(data.response ?? ""),
        thinkingText: String(data.thinkingText ?? "")
      });
    }
    if (event === "error") throw new Error(String(data.error ?? "Stream failed"));
  }, input.signal, input.files?.length ? handlers.onUploadComplete : undefined);
}
