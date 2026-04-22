import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { FileAttachment } from "../../agent/types.js";

function inferImageMime(pathname: string): string | null {
  const ext = extname(pathname).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return null;
}

export function rebuildImageContentsFromAttachments(
  attachments: FileAttachment[],
  onWarning?: (attachment: FileAttachment, error: unknown) => void
): ImageContent[] {
  const out: ImageContent[] = [];
  for (const attachment of attachments) {
    if (!attachment.isImage) continue;
    try {
      const bytes = readFileSync(attachment.local);
      const mimeType = attachment.mimeType || inferImageMime(attachment.local);
      if (!mimeType) continue;
      out.push({
        type: "image",
        mimeType,
        data: bytes.toString("base64")
      });
    } catch (error) {
      onWarning?.(attachment, error);
    }
  }
  return out;
}
