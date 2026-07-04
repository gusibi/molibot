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
