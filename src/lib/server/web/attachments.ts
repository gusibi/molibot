import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { FileAttachment } from "$lib/server/agent/core/types.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { ConversationAttachment } from "$lib/shared/types/message.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".pdf": "application/pdf"
};

function inferMediaType(mimeType?: string): FileAttachment["mediaType"] {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  return "file";
}

export function resolveWebAttachmentFilename(filePath: string, title?: string): string {
  const sourceName = basename(filePath) || "attachment";
  const sourceExt = extname(sourceName);
  const rawTitle = String(title ?? "").trim();
  if (!rawTitle) return sourceName;

  const displayName = basename(rawTitle);
  if (!displayName || displayName === "." || displayName === "..") return sourceName;
  if (/\.[A-Za-z0-9]{1,8}$/.test(displayName)) return displayName;
  return sourceExt ? `${displayName}${sourceExt}` : displayName;
}

export function toConversationAttachment(attachment: FileAttachment): ConversationAttachment {
  return {
    original: attachment.original,
    local: attachment.local,
    mediaType: attachment.mediaType,
    mimeType: attachment.mimeType,
    size: attachment.size
  };
}

export function saveWebResponseAttachment(options: {
  store: MomRuntimeStore;
  externalUserId: string;
  filePath: string;
  title?: string;
  ts?: string;
}): ConversationAttachment {
  const filename = resolveWebAttachmentFilename(options.filePath, options.title);
  const ext = extname(filename).toLowerCase() || extname(options.filePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  const saved = options.store.saveAttachment(
    options.externalUserId,
    filename,
    options.ts ?? `${Date.now() / 1000}`,
    readFileSync(options.filePath),
    {
      mediaType: inferMediaType(mimeType),
      mimeType
    }
  );
  return toConversationAttachment(saved);
}
