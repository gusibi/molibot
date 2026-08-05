import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveWebAttachmentFilename,
  resolveWebInboundFileMeta,
  saveWebResponseAttachment
} from "$lib/server/web/attachments.js";
import type { FileAttachment } from "$lib/server/agent/core/types.js";

test("an uploaded image is classified as an image when the WebView reports no MIME type", () => {
  // The regression: classifying on `File.type` alone made these plain "file"s,
  // which left `imageContents` empty and silently disabled the whole vision
  // path — no error, no notice, the model simply never saw the picture.
  assert.deepEqual(resolveWebInboundFileMeta({ name: "Screenshot.png", type: "" }), {
    mediaType: "image",
    mimeType: "image/png"
  });
  assert.deepEqual(
    resolveWebInboundFileMeta({ name: "photo.JPG", type: "application/octet-stream" }),
    { mediaType: "image", mimeType: "image/jpeg" }
  );
  assert.equal(resolveWebInboundFileMeta({ name: "IMG_0001.heic", type: "" }).mediaType, "image");
});

test("a declared MIME type still wins, and unknown files stay files", () => {
  assert.deepEqual(resolveWebInboundFileMeta({ name: "clip.bin", type: "image/webp" }), {
    mediaType: "image",
    mimeType: "image/webp"
  });
  assert.deepEqual(resolveWebInboundFileMeta({ name: "notes.md", type: "" }), { mediaType: "file" });
  assert.equal(resolveWebInboundFileMeta({ name: "voice.m4a", type: "" }).mediaType, "audio");
  assert.equal(resolveWebInboundFileMeta({ name: "clip.mov", type: "" }).mediaType, "video");
});

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
