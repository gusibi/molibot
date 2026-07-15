import {
  sanitizeImageGenerateSettings,
  sanitizeTtsGenerateSettings,
  sanitizeVideoGenerateSettings,
  sanitizeWebSearchSettings
} from "../sanitize.js";
import type { RuntimeSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

export function readWebSearchConfig(runtime: SettingsAccessor): RuntimeSettings["webSearch"] {
  return runtime.getSettings().webSearch;
}

export function updateWebSearchConfig(runtime: SettingsAccessor, raw: unknown): RuntimeSettings["webSearch"] {
  const current = runtime.getSettings();
  const sanitized = sanitizeWebSearchSettings(raw, current.webSearch);
  return runtime.updateSettings({ webSearch: sanitized }).webSearch;
}

export function readImageGenerateConfig(runtime: SettingsAccessor): RuntimeSettings["imageGenerate"] {
  return runtime.getSettings().imageGenerate;
}

export function updateImageGenerateConfig(runtime: SettingsAccessor, raw: unknown): RuntimeSettings["imageGenerate"] {
  const current = runtime.getSettings();
  const sanitized = sanitizeImageGenerateSettings(raw, current.imageGenerate);
  return runtime.updateSettings({ imageGenerate: sanitized }).imageGenerate;
}

export function readVideoGenerateConfig(runtime: SettingsAccessor): RuntimeSettings["videoGenerate"] {
  return runtime.getSettings().videoGenerate;
}

export function updateVideoGenerateConfig(runtime: SettingsAccessor, raw: unknown): RuntimeSettings["videoGenerate"] {
  const current = runtime.getSettings();
  const sanitized = sanitizeVideoGenerateSettings(raw, current.videoGenerate);
  return runtime.updateSettings({ videoGenerate: sanitized }).videoGenerate;
}

export function readTtsGenerateConfig(runtime: SettingsAccessor): RuntimeSettings["ttsGenerate"] {
  return runtime.getSettings().ttsGenerate;
}

export function updateTtsGenerateConfig(runtime: SettingsAccessor, raw: unknown): RuntimeSettings["ttsGenerate"] {
  const current = runtime.getSettings();
  const sanitized = sanitizeTtsGenerateSettings(raw, current.ttsGenerate);
  return runtime.updateSettings({ ttsGenerate: sanitized }).ttsGenerate;
}
