import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { createImageGenerateTool } from "$lib/server/agent/imageGenerate/imageGenerateTool.js";
import { getRuntime } from "$lib/server/app/runtime";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { sanitizeImageGenerateSettings } from "$lib/server/settings/sanitize.js";

export const POST: RequestHandler = async ({ request }) => {
  let body: { prompt?: string; engine?: string; imageGenerate?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const baseSettings = runtime.getSettings().imageGenerate;
  const imageGenerate = sanitizeImageGenerateSettings(body.imageGenerate ?? baseSettings, baseSettings);

  const dummyCtx = {
    getSettings: () => ({
      ...runtime.getSettings(),
      imageGenerate
    }),
    cwd: `${storagePaths.dataDir}/settings-image-tests`,
    workspaceDir: `${storagePaths.dataDir}/settings-image-tests`,
    artifactDir: "test-images"
  };

  try {
    const tool = createImageGenerateTool(dummyCtx);
    const result = await tool.execute("settings-test-call", {
      prompt: body.prompt || "A high quality cyberpunk logo design",
      engine: body.engine || "auto",
      outputName: `test_image_${Date.now()}.png`
    });
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
