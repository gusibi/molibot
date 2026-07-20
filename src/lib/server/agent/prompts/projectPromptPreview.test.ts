import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSystemPrompt } from "./prompt.js";
import { writeProjectSystemPromptPreview } from "./projectPromptPreview.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";

const here = dirname(fileURLToPath(import.meta.url));
const runnerSource = readFileSync(join(here, "../core/runner.ts"), "utf8");

test("Project Runner writes the preview after prompt hooks can transform the final prompt", () => {
  const transformIndex = runnerSource.indexOf('this.hookManager.transform("prompt.build.after"');
  const writeIndex = runnerSource.indexOf("writeProjectSystemPromptPreview({");
  assert.ok(transformIndex >= 0, "prompt transform hook is missing");
  assert.ok(writeIndex > transformIndex, "Project preview must be written after the final prompt transform");
  assert.match(
    runnerSource,
    /targetDir: dirname\(this\.store\.getWorkspaceDir\(\)\)/,
    "Project preview must follow the injected runtime store instead of a global live-data path"
  );
});

test("Project preview is written at the Project workspace root with effective instruction sources", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-project-preview-"));
  const runtimeWorkspaceDir = join(root, "projects", "wiki", "runtime");
  const projectWorkspaceDir = join(root, "projects", "wiki");
  const projectRoot = join(root, "source");
  const project = {
    id: "wiki",
    name: "Wiki",
    rootPath: projectRoot,
    scratchDir: join(runtimeWorkspaceDir, "scratch")
  };
  try {
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "AGENT.md"), "PROJECT-AGENT-MARKER", { encoding: "utf8", flag: "wx" });
    const rendered = buildSystemPrompt(
      runtimeWorkspaceDir,
      "chat-1",
      "session-1",
      "(memory envelope)",
      { channel: "web", settings: defaultRuntimeSettings, project }
    );
    const finalPrompt = `${rendered}\n\nHOOK-FINAL-MARKER`;
    const filePath = writeProjectSystemPromptPreview({
      targetDir: projectWorkspaceDir,
      runtimeWorkspaceDir,
      channel: "web",
      chatId: "chat-1",
      sessionId: "session-1",
      settings: defaultRuntimeSettings,
      project,
      prompt: finalPrompt,
      generatedAt: "2026-07-19T00:00:00.000Z"
    });

    assert.equal(filePath, join(projectWorkspaceDir, "SYSTEM_PROMPT.preview.md"));
    assert.equal(existsSync(join(runtimeWorkspaceDir, "SYSTEM_PROMPT.preview.md")), false);
    const preview = readFileSync(filePath, "utf8");
    assert.match(preview, /# Project System Prompt Preview/);
    assert.match(preview, /- project_id: wiki/);
    assert.match(preview, /- final_prompt_after_hooks: true/);
    assert.match(preview, new RegExp(`- project_context_sources: ${projectRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/AGENT\\.md`));
    assert.match(preview, /PROJECT-AGENT-MARKER/);
    assert.match(preview, /HOOK-FINAL-MARKER/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
