import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/index.js";
import { readWorkspaceVisionSmokeImage } from "$lib/server/providers/visionSmokeFixture.js";
import { createImageAnalyzeTool, runImageAnalyze } from "$lib/server/agent/tools/imageAnalyze.js";

test("runImageAnalyze reads a workspace image and delegates to the configured vision capability", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-image-analyze-"));
  const fixture = readWorkspaceVisionSmokeImage(workspaceDir);
  let received: any;
  const result = await runImageAnalyze({
    path: relative(workspaceDir, fixture.path),
    prompt: "Extract the receipt total exactly."
  }, {
    channel: "test",
    cwd: workspaceDir,
    workspaceDir,
    spillDir: join(workspaceDir, "tool-output"),
    getSettings: () => defaultRuntimeSettings,
    analyzeImage: async (options) => {
      received = options;
      return {
        text: "Total: $19.90",
        errorMessage: null,
        providerId: "vision-provider",
        modelId: "vision-model"
      };
    }
  });

  assert.equal(result.text, "Total: $19.90");
  assert.equal(received.instruction, "Extract the receipt total exactly.");
  assert.equal(received.image.mimeType, "image/png");
  assert.ok(received.image.data.length > 0);
  assert.equal(result.details.modelId, "vision-model");
});

test("runImageAnalyze rejects unsupported files and realpath escapes", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-image-guard-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "molibot-image-outside-"));
  const fixture = readWorkspaceVisionSmokeImage(outsideDir);
  const escaped = join(workspaceDir, "escaped.png");
  symlinkSync(fixture.path, escaped);

  await assert.rejects(
    runImageAnalyze({ path: "escaped.png" }, {
      channel: "test",
      cwd: workspaceDir,
      workspaceDir,
      getSettings: () => defaultRuntimeSettings,
      analyzeImage: async () => ({ text: "must not run", errorMessage: null })
    }),
    /outside allowed workspace roots/
  );
  writeFileSync(join(workspaceDir, "notes.txt"), "not an image");
  await assert.rejects(
    runImageAnalyze({ path: "notes.txt" }, {
      channel: "test",
      cwd: workspaceDir,
      workspaceDir,
      getSettings: () => defaultRuntimeSettings
    }),
    /Unsupported image type|directory/i
  );
});

test("createImageAnalyzeTool exposes a sequential route-driven contract without a model parameter", () => {
  const tool = createImageAnalyzeTool({
    channel: "test",
    cwd: "/workspace",
    workspaceDir: "/workspace",
    getSettings: () => defaultRuntimeSettings
  });
  assert.equal(tool.name, "imageAnalyze");
  assert.equal(tool.executionMode, "sequential");
  assert.doesNotMatch(JSON.stringify(tool.parameters), /modelKey|providerId/);
  assert.match(tool.description, /current Agent\/global vision route/);
});
