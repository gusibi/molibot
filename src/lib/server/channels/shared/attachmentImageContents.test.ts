import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rebuildImageContentsFromAttachments } from "./attachmentImageContents.js";

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0yoAAAAASUVORK5CYII=";

test("rebuildImageContentsFromAttachments resolves queued relative attachment paths from workspace", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-attachments-"));
  const local = "chat-1/attachments/image.png";
  mkdirSync(join(workspaceDir, "chat-1/attachments"), { recursive: true });
  writeFileSync(join(workspaceDir, local), Buffer.from(SAMPLE_PNG_BASE64, "base64"));

  const images = rebuildImageContentsFromAttachments([
    {
      original: "image.png",
      local,
      mediaType: "image",
      mimeType: "image/png",
      isImage: true,
      isAudio: false,
      isVideo: false
    }
  ], workspaceDir);

  assert.equal(images.length, 1);
  assert.equal(images[0]?.type, "image");
  assert.equal(images[0]?.mimeType, "image/png");
  assert.equal(images[0]?.data, SAMPLE_PNG_BASE64);
});
