import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadTool } from "$lib/server/agent/tools/read.js";
import { defaultRuntimeSettings } from "$lib/server/settings/index.js";

function makeTool(cwd: string) {
  return createReadTool({ cwd, workspaceDir: cwd });
}

function textOf(result: any): string {
  return (result.content[0] as any)?.text ?? "";
}

test("read returns full content of a small file", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    writeFileSync(join(cwd, "a.txt"), "line1\nline2\nline3\n");
    const result = await makeTool(cwd).execute("t1", { label: "read", path: "a.txt" });
    assert.equal(textOf(result), "line1\nline2\nline3\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("read counts lines correctly for files with trailing newline", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    writeFileSync(join(cwd, "a.txt"), "l1\nl2\nl3\n");
    // 3 lines total; offset=4 must be rejected as beyond EOF.
    await assert.rejects(
      makeTool(cwd).execute("t1", { label: "read", path: "a.txt", offset: 4 }),
      /beyond end of file \(3 lines total\)/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("read honors offset and limit with continuation hint", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    writeFileSync(join(cwd, "a.txt"), lines.join("\n") + "\n");
    const result = await makeTool(cwd).execute("t1", { label: "read", path: "a.txt", offset: 3, limit: 2 });
    const text = textOf(result);
    assert.match(text, /^line3\nline4/);
    assert.match(text, /6 more lines\. Use offset=5 to continue/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("read rejects binary files", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    writeFileSync(join(cwd, "blob.bin"), Buffer.from([0x41, 0x00, 0x42, 0x00, 0xff]));
    await assert.rejects(
      makeTool(cwd).execute("t1", { label: "read", path: "blob.bin" }),
      /binary file/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("read routes supported binary documents to docExtract", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    writeFileSync(join(cwd, "report.pdf"), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00]));
    await assert.rejects(
      makeTool(cwd).execute("t1", { label: "read", path: "report.pdf" }),
      /Use docExtract for this document/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("read rejects an oversized image it cannot decode", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    // Not a real PNG, so there is nothing to downscale.
    writeFileSync(join(cwd, "big.png"), Buffer.alloc(6 * 1024 * 1024));
    await assert.rejects(
      makeTool(cwd).execute("t1", { label: "read", path: "big.png" }),
      /could not be resized/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

/** Build a valid, poorly-compressible PNG so the encoded file exceeds the limit. */
function makeNoisePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width * 3; x += 1) {
      raw[offset] = Math.floor(Math.random() * 256);
      offset += 1;
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

test("read downscales an oversized image instead of failing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    const png = makeNoisePng(1600, 1600);
    assert.ok(png.length > 5 * 1024 * 1024, "fixture must exceed the image limit");
    writeFileSync(join(cwd, "big.png"), png);

    const result = await makeTool(cwd).execute("t1", { label: "read", path: "big.png" });

    const image = result.content.find((part: any) => part.type === "image") as any;
    assert.ok(image, "an image block must still be returned");
    const decodedBytes = Buffer.from(image.data, "base64").length;
    assert.ok(
      decodedBytes <= 5 * 1024 * 1024,
      `resized image must fit the limit, got ${decodedBytes} bytes`
    );
    assert.match(textOf(result), /Read image file/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("read sends image content directly when the active model supports vision", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-native-image-"));
  try {
    writeFileSync(join(cwd, "screen.png"), Buffer.from("image-bytes"));
    let recognitionCalls = 0;
    const tool = createReadTool({
      cwd,
      workspaceDir: cwd,
      channel: "test",
      getSettings: () => defaultRuntimeSettings,
      getActiveModelSupportsVision: () => true,
      recognizeImage: async () => {
        recognitionCalls += 1;
        throw new Error("must not run");
      }
    });

    const result = await tool.execute("t1", { path: "screen.png", prompt: "Inspect the error" });
    assert.ok(result.content.some((part: any) => part.type === "image"));
    assert.equal(recognitionCalls, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("read recognizes the same image on demand more than once for a text-only model", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-recognized-image-"));
  try {
    writeFileSync(join(cwd, "screen.png"), Buffer.from("image-bytes"));
    const prompts: string[] = [];
    const tool = createReadTool({
      cwd,
      workspaceDir: cwd,
      channel: "test",
      getSettings: () => defaultRuntimeSettings,
      getActiveModelSupportsVision: () => false,
      recognizeImage: async ({ prompt }) => {
        prompts.push(prompt ?? "");
        return {
          text: `evidence:${prompt}`,
          engineId: "vision-a",
          attempts: [{ engineId: "vision-a", ok: true, durationMs: 1 }],
          warnings: []
        };
      }
    });

    const first = await tool.execute("t1", { path: "screen.png", prompt: "Read all text" });
    const second = await tool.execute("t2", { path: "screen.png", prompt: "Inspect layout" });

    assert.deepEqual(prompts, ["Read all text", "Inspect layout"]);
    assert.match(textOf(first), /evidence:Read all text/);
    assert.match(textOf(second), /evidence:Inspect layout/);
    assert.equal(first.content.some((part: any) => part.type === "image"), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
