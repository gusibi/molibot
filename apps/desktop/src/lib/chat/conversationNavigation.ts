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
  previewText: string;
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
  return messages
    .filter((message) => message.role === "user" && Boolean(message.id?.trim()))
    .map((message, turnIndex) => {
      const content = plainText(transcriptDisplayContent(message));
      const previewText = truncatePreview([...attachmentLabels(message, labels), content].filter(Boolean).join(" ") || labels.empty);
      return {
        messageId: message.id!.trim(),
        turnIndex,
        previewText,
        createdAt: message.createdAt
      };
    });
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
