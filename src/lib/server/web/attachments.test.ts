import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWebAttachmentFilename, saveWebResponseAttachment } from "$lib/server/web/attachments.js";
import type { FileAttachment } from "$lib/server/agent/core/types.js";

test("resolveWebAttachmentFilename preserves the source extension when title has none", () => {
  assert.equal(
    resolveWebAttachmentFilename("/workspace/2026/06/20/example_com_screenshot.png", "Example.com 网页截图"),
    "Example.com 网页截图.png"
  );
});

test("saveWebResponseAttachment persists image metadata for extensionless titles", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-web-attachment-"));
  try {
    const filePath = join(dir, "example_com_screenshot.png");
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    let captured: {
      chatId?: string;
      filename?: string;
      meta?: { mediaType?: FileAttachment["mediaType"]; mimeType?: string };
    } = {};

    const attachment = saveWebResponseAttachment({
      store: {
        saveAttachment: (
          chatId: string,
          filename: string,
          _ts: string,
          content: Buffer,
          meta?: { mediaType?: FileAttachment["mediaType"]; mimeType?: string }
        ) => {
          captured = { chatId, filename, meta };
          return {
            original: filename,
            local: `${chatId}/attachments/${filename}`,
            mediaType: meta?.mediaType ?? "file",
            mimeType: meta?.mimeType,
            size: content.byteLength,
            isImage: meta?.mediaType === "image",
            isAudio: meta?.mediaType === "audio",
            isVideo: meta?.mediaType === "video"
          };
        }
      } as any,
      externalUserId: "web:user",
      filePath,
      title: "Example.com 网页截图",
      ts: "1780000000"
    });

    assert.equal(captured.chatId, "web:user");
    assert.equal(captured.filename, "Example.com 网页截图.png");
    assert.deepEqual(captured.meta, { mediaType: "image", mimeType: "image/png" });
    assert.equal(attachment.mediaType, "image");
    assert.equal(attachment.mimeType, "image/png");
    assert.equal(attachment.original, "Example.com 网页截图.png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
