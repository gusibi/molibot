import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { createTtsGenerateTool } from "$lib/server/agent/ttsGenerate/ttsGenerateTool.js";
import { getRuntime } from "$lib/server/app/runtime";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { sanitizeTtsGenerateSettings } from "$lib/server/settings/sanitize.js";

export const POST: RequestHandler = async ({ request }) => {
  let body: { text?: string; provider?: string; voice?: string; model?: string; style?: string; format?: string; ttsGenerate?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const baseSettings = runtime.getSettings().ttsGenerate;
  const ttsGenerate = sanitizeTtsGenerateSettings(body.ttsGenerate ?? baseSettings, baseSettings);
  const testRoot = `${storagePaths.dataDir}/settings-tts-tests`;

  try {
    const tool = createTtsGenerateTool({
      getSettings: () => ({
        ...runtime.getSettings(),
        ttsGenerate
      }),
      cwd: testRoot,
      workspaceDir: testRoot,
      artifactDir: "test-audio"
    });
    const result = await tool.execute("settings-tts-test-call", {
      text: body.text || "你好，这是 Molibot 的语音合成测试。",
      provider: body.provider,
      voice: body.voice,
      model: body.model,
      style: body.style,
      format: body.format,
      fileName: `test_tts_${Date.now()}.${body.format || "wav"}`,
      autoUpload: false
    });
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
