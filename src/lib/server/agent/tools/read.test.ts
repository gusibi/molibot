import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadTool } from "$lib/server/agent/tools/read.js";

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

test("read rejects oversized images", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-read-"));
  try {
    writeFileSync(join(cwd, "big.png"), Buffer.alloc(6 * 1024 * 1024));
    await assert.rejects(
      makeTool(cwd).execute("t1", { label: "read", path: "big.png" }),
      /too large to read/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
