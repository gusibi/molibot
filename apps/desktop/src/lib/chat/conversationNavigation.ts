import { transcriptDisplayContent, type TranscriptMessage } from "./transcript";

export const PROMPT_NAVIGATOR_MIN_TURNS = 5;

export type PromptPreviewLabels = {
  image: string;
  audio: string;
  file: (name: string) => string;
  empty: string;
};

export type PromptNavigationItem = {
  messageId: string;
  turnIndex: number;
  userPreviewText: string;
  assistantPreviewText: string;
  createdAt?: string;
};

function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```(?:\w+)?\s*([\s\S]*?)```/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" })[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function truncatePreview(value: string, maxLength = 80): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}

function attachmentLabels(message: TranscriptMessage, labels: PromptPreviewLabels): string[] {
  return (message.attachments ?? []).map((attachment) => {
    if (attachment.mediaType === "image") return labels.image;
    if (attachment.mediaType === "audio") return labels.audio;
    return labels.file(attachment.original);
  });
}

export function extractPromptNavigationItems(
  messages: TranscriptMessage[],
  labels: PromptPreviewLabels
): PromptNavigationItem[] {
  const items: PromptNavigationItem[] = [];

  messages.forEach((message, messageIndex) => {
    const messageId = message.id?.trim();
    if (message.role !== "user" || !messageId) return;

    const userContent = plainText(transcriptDisplayContent(message));
    const assistantContent: string[] = [];
    for (let index = messageIndex + 1; index < messages.length && messages[index].role !== "user"; index += 1) {
      if (messages[index].role === "assistant") {
        const content = plainText(transcriptDisplayContent(messages[index]));
        if (content) assistantContent.push(content);
      }
    }

    items.push({
      messageId,
      turnIndex: items.length,
      userPreviewText: truncatePreview([...attachmentLabels(message, labels), userContent].filter(Boolean).join(" ") || labels.empty),
      assistantPreviewText: truncatePreview(assistantContent.join(" "), 160),
      createdAt: message.createdAt
    });
  });

  return items;
}

export function layoutPromptMarkers(
  itemCount: number,
  navigatorHeight: number,
  markerPitch = 12
): number[] {
  if (itemCount <= 0 || navigatorHeight <= 0) return [];
  const edge = Math.min(8, navigatorHeight / 2);
  const available = Math.max(0, navigatorHeight - edge * 2);
  const pitch = itemCount > 1 ? Math.min(markerPitch, available / (itemCount - 1)) : 0;
  const stackHeight = pitch * (itemCount - 1);
  const start = edge + (available - stackHeight) / 2;
  return Array.from({ length: itemCount }, (_, index) => start + pitch * index);
}

export function activePromptIndex(offsets: number[], readingPosition: number): number {
  if (offsets.length === 0) return -1;
  let low = 0;
  let high = offsets.length - 1;
  let answer = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= readingPosition) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

export function dockMarkerWidth(
  markerY: number,
  pointerY: number | null,
  baseWidth = 6,
  maxWidth = 46,
  sigma = 16
): number {
  if (pointerY === null) return baseWidth;
  const distance = Math.abs(pointerY - markerY);
  const influence = Math.exp(-(distance * distance) / (2 * sigma * sigma));
  return baseWidth + influence * (maxWidth - baseWidth);
}
