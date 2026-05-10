import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteTool } from "./write.js";

test("write routes plain scratch artifacts into dated artifact folder", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-write-"));
  try {
    const tool = createWriteTool({
      cwd,
      workspaceDir: cwd,
      chatId: "chat-1",
      artifactDir: "2026/05/10"
    });

    const result = await tool.execute("tool-1", {
      label: "write",
      path: "report.md",
      content: "hello"
    });

    assert.equal(readFileSync(join(cwd, "2026/05/10/report.md"), "utf8"), "hello");
    assert.equal(existsSync(join(cwd, "report.md")), false);
    assert.match(result.content[0]?.text ?? "", /2026\/05\/10\/report\.md/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("write keeps explicit scratch subdirectories unchanged", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-write-"));
  try {
    const tool = createWriteTool({
      cwd,
      workspaceDir: cwd,
      chatId: "chat-1",
      artifactDir: "2026/05/10"
    });

    await tool.execute("tool-1", {
      label: "write",
      path: "events/reminder.json",
      content: "{}"
    });

    assert.equal(readFileSync(join(cwd, "events/reminder.json"), "utf8"), "{}");
    assert.equal(existsSync(join(cwd, "2026/05/10/events/reminder.json")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
