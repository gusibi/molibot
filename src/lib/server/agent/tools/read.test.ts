import test from "node:test";
import assert from "node:assert/strict";
import { promises as fsp, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadTool, getReadToolDefinition } from "$lib/server/agent/tools/read.js";
import { ToolRegistry, ToolRuntime } from "$lib/server/agent/tools/toolRuntime.js";
import type { ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
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

function runtimeContext(cwd: string): ToolExecutionContext {
  return {
    runId: "run-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "agent-1",
    cwd,
    fs: {
      readText: (p: string) => fsp.readFile(p, "utf8"),
      writeText: (p: string, c: string) => fsp.writeFile(p, c, "utf8"),
      readBuffer: (p: string) => fsp.readFile(p),
      stat: async (p: string) => {
        try {
          const info = await fsp.stat(p, { bigint: true });
          return { version: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` };
        } catch {
          return undefined;
        }
      }
    },
    shell: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    network: { fetch: async () => ({}) },
    emit: () => {}
  };
}

test("the read tool reuses an unchanged file through the shared tool runtime but re-reads an edit", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-reuse-"));
  try {
    writeFileSync(join(cwd, "a.txt"), "alpha\nbeta\n");
    const registry = new ToolRegistry();
    registry.register(getReadToolDefinition({ cwd, workspaceDir: cwd }));
    const runtime = new ToolRuntime(registry);
    const ctx = runtimeContext(cwd);

    const first = await runtime.executeToolCall({ toolId: "read", input: { path: "a.txt" }, context: ctx });
    const second = await runtime.executeToolCall({ toolId: "read", input: { path: "a.txt" }, context: ctx });
    assert.equal((second.metadata as any)?.resultReused, true);
    assert.match(((second.content as any[])[0] as { text: string }).text, /Reused a previous read of "a\.txt"/);
    assert.match(((second.content as any[])[0] as { text: string }).text, /alpha/);

    // A write must invalidate the cached read so the edit is visible.
    writeFileSync(join(cwd, "a.txt"), "gamma\n");
    const third = await runtime.executeToolCall({ toolId: "read", input: { path: "a.txt" }, context: ctx });
    assert.equal((third.metadata as any)?.resultReused, undefined);
    assert.match(((third.content as any[])[0] as { text: string }).text, /gamma/);
    assert.equal(first.ok, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("external writes and replacements with preserved size and mtime invalidate reads", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-version-"));
  try {
    const path = join(cwd, "a.txt");
    await fsp.writeFile(path, "old");
    await fsp.utimes(path, 1700000000, 1700000000);
    const registry = new ToolRegistry();
    registry.register(getReadToolDefinition({ cwd, workspaceDir: cwd }));
    const runtime = new ToolRuntime(registry);
    const ctx = runtimeContext(cwd);
    const read = () => runtime.executeToolCall({ toolId: "read", input: { path: "a.txt" }, context: ctx });
    await read();
    await fsp.writeFile(path, "new");
    await fsp.utimes(path, 1700000000, 1700000000);
    const changed = await read();
    assert.equal(changed.metadata?.resultReused, undefined);
    assert.equal((changed.content as any[])[0].text, "new");
    await fsp.writeFile(join(cwd, "replacement"), "end");
    await fsp.utimes(join(cwd, "replacement"), 1700000000, 1700000000);
    await fsp.rename(join(cwd, "replacement"), path);
    const replaced = await read();
    assert.equal(replaced.metadata?.resultReused, undefined);
    assert.equal((replaced.content as any[])[0].text, "end");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("read preserves filename whitespace and explicit refresh performs a physical read", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-path-"));
  try {
    await fsp.writeFile(join(cwd, "a.txt"), "one");
    await fsp.writeFile(join(cwd, " a.txt"), "two");
    const registry = new ToolRegistry();
    registry.register(getReadToolDefinition({ cwd, workspaceDir: cwd }));
    const runtime = new ToolRuntime(registry);
    const ctx = runtimeContext(cwd);
    let physicalReads = 0;
    ctx.fs.readBuffer = async p => { physicalReads++; return fsp.readFile(p); };
    const read = (input: object) => runtime.executeToolCall({ toolId: "read", input, context: ctx });
    await read({ path: "a.txt" });
    const padded = await read({ path: " a.txt" });
    assert.equal((padded.content as any[])[0].text, "two");
    await read({ path: "a.txt" });
    assert.equal(physicalReads, 2);
    const fresh = await read({ path: "a.txt", refresh: true });
    assert.equal(physicalReads, 3);
    assert.equal(fresh.metadata?.resultReused, undefined);
    assert.equal((fresh.content as any[])[0].text, "one");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("fractional offsets do not collide with integer read requests", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-offset-"));
  try {
    await fsp.writeFile(join(cwd, "a.txt"), "one\ntwo\nthree");
    const registry = new ToolRegistry();
    registry.register(getReadToolDefinition({ cwd, workspaceDir: cwd }));
    const runtime = new ToolRuntime(registry);
    const ctx = runtimeContext(cwd);
    await runtime.executeToolCall({ toolId: "read", input: { path: "a.txt", offset: 1.5 }, context: ctx });
    const second = await runtime.executeToolCall({ toolId: "read", input: { path: "a.txt", offset: 1 }, context: ctx });
    assert.equal(second.metadata?.resultReused, undefined);
    assert.match((second.content as any[])[0].text, /one\ntwo\nthree/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
