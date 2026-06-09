import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { listMacosSayVoices } from "$lib/server/agent/ttsGenerate/providers.js";
import { XIAOMI_TTS_VOICES } from "$lib/server/agent/ttsGenerate/types.js";

export const GET: RequestHandler = async ({ url }) => {
  const provider = url.searchParams.get("provider") || "macos";

  if (provider === "xiaomi") {
    return json({ ok: true, provider, available: true, voices: XIAOMI_TTS_VOICES });
  }

  if (provider !== "macos") {
    return json({ ok: false, error: `Invalid provider: ${provider}` }, { status: 400 });
  }

  if (process.platform !== "darwin") {
    return json({ ok: true, provider, available: false, voices: [] });
  }

  try {
    const voices = await listMacosSayVoices();
    return json({ ok: true, provider, available: true, voices });
  } catch (error) {
    return json({
      ok: true,
      provider,
      available: true,
      voices: [],
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
