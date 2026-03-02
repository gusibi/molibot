import type { RuntimeSettings } from "../../settings/index.js";
import { transcribeAudioViaConfiguredProvider } from "../shared/stt.js";
import type { TranscriptionResult } from "./types.js";

export async function transcribeTelegramAudio(
  settings: RuntimeSettings,
  data: Buffer,
  filename: string,
  mimeType?: string
): Promise<TranscriptionResult> {
  return transcribeAudioViaConfiguredProvider({
    channel: "telegram",
    settings,
    data,
    filename,
    mimeType
  });
}
