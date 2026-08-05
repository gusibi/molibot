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
  ".pdf": "application/pdf",
  // Formats a browser/WebView often hands over with an empty `File.type`.
  // Without them an uploaded screenshot is classified as a plain file and the
  // whole vision path silently concludes "no image this turn".
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff"
};

function inferMediaType(mimeType?: string): FileAttachment["mediaType"] {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  return "file";
}

/**
 * Classifies an uploaded file for the Web/desktop intake.
 *
 * `File.type` alone is not evidence: the WebView hands over an empty string (or
 * `application/octet-stream`) for drag-and-drop, for formats it does not know,
 * and for files synthesized from a path. Classifying on MIME only made an
 * uploaded screenshot a plain "file", which left `imageContents` empty — and
 * because the whole vision path is gated on that array being non-empty, the
 * runtime correctly concluded "no image this turn" and reported nothing. The
 * filename extension is the fallback evidence, exactly as the channel intakes
 * treat a downloaded resource.
 */
export function resolveWebInboundFileMeta(file: { name?: string; type?: string }): {
  mediaType: FileAttachment["mediaType"];
  mimeType?: string;
} {
  const declared = String(file.type ?? "").toLowerCase().trim();
  const usableDeclared = declared && declared !== "application/octet-stream" ? declared : "";
  const ext = extname(String(file.name ?? "")).toLowerCase();
  const mimeType = usableDeclared || MIME_BY_EXT[ext];
  return { mediaType: inferMediaType(mimeType), ...(mimeType ? { mimeType } : {}) };
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
