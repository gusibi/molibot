import type { DesktopConversationActivity, DesktopFileMediaType, DesktopMessageMemoryTraceMeta, DesktopSessionFile } from "@molibot/desktop-contract";

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
  model?: string;
  thinking?: string;
  stopReason?: string;
  errorMessage?: string;
  attachments?: TranscriptAttachment[];
  activities?: DesktopConversationActivity[];
  memoryTrace?: DesktopMessageMemoryTraceMeta;
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
  contributions?: TranscriptContributionAction[];
  onRunContribution?: (
    action: TranscriptContributionAction,
    message: TranscriptMessage,
    file: DesktopSessionFile
  ) => void;
};

/**
 * Hover actions for a transcript message. `onCopy` is always available; the
 * edit and fork buttons are only surfaced for the user's own messages on
 * surfaces that opt in (never on the read-only external transcript view).
 * `copiedId` lets the copy button flash a check mark.
 *
 * Edit and fork are deliberately distinct: `onEditUser` rewrites the current
 * Session in place (the original message and everything after it is dropped),
 * while `onForkUser` leaves it untouched and branches into a child Session.
 * Project chat opts into edit only - forking project Sessions is not supported
 * server-side yet. `forkingId` marks an in-flight fork so its button can show
 * progress and reject a second click.
 */
export type TranscriptMessageActions = {
  copiedId: string;
  onCopy: (message: TranscriptMessage) => void;
  onEditUser?: (message: TranscriptMessage) => void;
  editingId?: string;
  onForkUser?: (message: TranscriptMessage) => void;
  forkingId?: string;
  onOpenMemoryTrace?: (traceId: string) => void;
  contributions?: TranscriptContributionAction[];
  pendingContributionKey?: string;
  successfulContributionKey?: string;
  onRunContribution?: (
    action: TranscriptContributionAction,
    message: TranscriptMessage,
    selection?: string
  ) => void;
};

export type TranscriptContributionAction = {
  id: string;
  label: string;
  icon?: string;
  appId: string;
  tool: string;
  accepts: Array<"text" | "image" | "file">;
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

/** Returns navigable message ids whose rendered text matches the query. */
export function findTranscriptMatches(
  messages: TranscriptMessage[],
  query: string,
  assistantErrorText = ""
): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return messages.flatMap((message) => {
    const id = message.id?.trim();
    if (!id) return [];
    const visibleText = transcriptDisplayContent(message, assistantErrorText).toLocaleLowerCase();
    return visibleText.includes(needle) ? [id] : [];
  });
}

/** Keeps the active result valid when the query, transcript, or Session changes. */
export function clampTranscriptSearchIndex(index: number, matchCount: number): number {
  if (matchCount <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), matchCount - 1);
}
