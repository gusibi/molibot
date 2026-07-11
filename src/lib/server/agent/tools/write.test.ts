import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteTool } from "$lib/server/agent/tools/write.js";

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
    assert.match((result.content[0] as any)?.text ?? "", /2026\/05\/10\/report\.md/);
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

test("project write defaults plain names to the project root and supports explicit scratch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-project-write-"));
  const runtime = mkdtempSync(join(tmpdir(), "molibot-project-runtime-"));
  const scratchRoot = join(runtime, "scratch", "2026", "07", "11");
  try {
    const tool = createWriteTool({
      cwd,
      workspaceDir: runtime,
      chatId: "chat-1",
      outputLayout: {
        projectRoot: cwd,
        scratchRoot
      }
    });

    const projectResult = await tool.execute("tool-1", {
      label: "write",
      path: "README.md",
      content: "project"
    });
    const scratchResult = await tool.execute("tool-2", {
      label: "write",
      path: "report.md",
      target: "scratch",
      content: "scratch"
    });

    assert.equal(readFileSync(join(cwd, "README.md"), "utf8"), "project");
    assert.equal(readFileSync(join(scratchRoot, "report.md"), "utf8"), "scratch");
    assert.deepEqual(projectResult.details, {
      requestedPath: "README.md",
      relativePath: "README.md",
      rootKind: "project",
      action: "created",
      sizeBytes: 7
    });
    assert.equal((scratchResult.details as any)?.rootKind, "scratch");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(runtime, { recursive: true, force: true });
  }
});

test("project write classifies an absolute scratch path as scratch even when scratch is nested under the project root", async () => {
  // scratchRoot lives inside projectRoot, so a scratch path is also within the
  // project root. The classifier must pick the more-specific scratch root first.
  const projectRoot = mkdtempSync(join(tmpdir(), "molibot-project-nested-"));
  const runtime = mkdtempSync(join(tmpdir(), "molibot-project-nested-runtime-"));
  const scratchRoot = join(projectRoot, "scratch", "2026", "07", "11");
  try {
    const tool = createWriteTool({
      cwd: projectRoot,
      workspaceDir: runtime,
      chatId: "chat-1",
      outputLayout: { projectRoot, scratchRoot }
    });

    const result = await tool.execute("tool-1", {
      label: "write",
      path: join(scratchRoot, "generated.png"),
      content: "x"
    });

    assert.equal(readFileSync(join(scratchRoot, "generated.png"), "utf8"), "x");
    const details = result.details as { rootKind: string; relativePath: string } | undefined;
    assert.equal(details?.rootKind, "scratch");
    assert.equal(details?.relativePath, "generated.png");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(runtime, { recursive: true, force: true });
  }
});
