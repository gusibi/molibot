import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { createVideoGenerateTool } from "$lib/server/agent/videoGenerate/videoGenerateTool.js";
import { getRuntime } from "$lib/server/app/runtime";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { sanitizeVideoGenerateSettings } from "$lib/server/settings/sanitize.js";

export const POST: RequestHandler = async ({ request }) => {
  let body: { prompt?: string; engine?: string; videoGenerate?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const baseSettings = runtime.getSettings().videoGenerate;
  const videoGenerate = sanitizeVideoGenerateSettings(body.videoGenerate ?? baseSettings, baseSettings);

  const dummyCtx = {
    getSettings: () => ({
      ...runtime.getSettings(),
      videoGenerate
    }),
    cwd: `${storagePaths.dataDir}/settings-video-tests`,
    workspaceDir: `${storagePaths.dataDir}/settings-video-tests`,
    artifactDir: "test-videos"
  };

  try {
    const tool = createVideoGenerateTool(dummyCtx);
    const result = await tool.execute("settings-test-call", {
      prompt: body.prompt || "A high quality slow cinematic panning of a river",
      engine: body.engine || "auto",
      outputName: `test_video_${Date.now()}.mp4`
    });
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
