import type { DesktopConversationActivity, DesktopFileMediaType, DesktopSessionFile } from "@molibot/desktop-contract";

export type TranscriptAttachment = {
  original: string;
  local?: string;
  mediaType: DesktopFileMediaType;
  mimeType?: string;
  size?: number;
};

export type TranscriptMessage = {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  thinking?: string;
  attachments?: TranscriptAttachment[];
  activities?: DesktopConversationActivity[];
};

export type TranscriptAttachmentActions = {
  filesByLocal: Map<string, DesktopSessionFile>;
  mediaUrls: Map<string, string>;
  mediaLoading: Set<string>;
  mediaFailed: Set<string>;
  loadMedia: (file: DesktopSessionFile) => void;
  canPreview: (file: DesktopSessionFile) => boolean;
  preview: (file: DesktopSessionFile) => void;
  download: (file: DesktopSessionFile) => void;
};

/**
 * Hover actions for a transcript message. `onCopy` is always available; the
 * edit button is only surfaced for the user's own messages on surfaces that
 * opt in (the main chat and project chat - never on the read-only external
 * transcript view). `copiedId` lets the button flash a check mark.
 */
export type TranscriptMessageActions = {
  copiedId: string;
  onCopy: (message: TranscriptMessage) => void;
  onEditUser?: (message: TranscriptMessage) => void;
  editingId?: string;
};

/**
 * A persisted message's run is over, so a "running" activity can never finish
 * (it was interrupted before its end event, or written by an older build).
 * Close such entries out as errors so the transcript never shows an eternal
 * spinner. Live (in-turn) activity lists must NOT go through this.
 */
export function finalizeTranscriptActivities(
  activities: DesktopConversationActivity[] | undefined
): DesktopConversationActivity[] | undefined {
  if (!activities?.length) return activities;
  if (!activities.some((activity) => activity.state === "running")) return activities;
  return activities.map((activity) =>
    activity.state === "running" ? { ...activity, state: "error" } : activity
  );
}

export function transcriptDisplayContent(message: TranscriptMessage, assistantErrorText = ""): string {
  const content = message.content.trim();
  if (message.attachments?.length && ["(attachment)", "(empty response)"].includes(content.toLowerCase())) {
    return "";
  }
  if (message.role === "assistant" && content === "Sorry, something went wrong." && assistantErrorText) {
    return assistantErrorText;
  }
  return content;
}
