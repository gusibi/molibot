import type { ChildProcess } from "node:child_process";
import type { TtsGenerateAudioFormat, TtsGenerateProviderId, TtsGenerateSettings } from "$lib/server/settings/index.js";

export type TtsGenerateProvider = TtsGenerateProviderId;
export type TtsGenerateFormat = TtsGenerateAudioFormat;

export interface TtsGenerateInput {
  text: string;
  provider?: TtsGenerateProvider;
  voice?: string;
  model?: string;
  style?: string;
  format?: TtsGenerateFormat;
  outputPath?: string;
}

export interface TtsGenerateProviderResult {
  audioBuffer?: Buffer;
  outputPath?: string;
  mimeType: string;
  extension: string;
  voice: string;
  model?: string;
  format: TtsGenerateFormat;
}

export interface TtsGenerateProviderContext {
  settings: TtsGenerateSettings;
  fetch: typeof fetch;
  platform: NodeJS.Platform;
  spawn: (command: string, args: string[], options?: Record<string, unknown>) => ChildProcess;
  signal?: AbortSignal;
}

export interface TtsGenerateProviderAdapter {
  id: TtsGenerateProvider;
  generate(input: TtsGenerateInput, context: TtsGenerateProviderContext): Promise<TtsGenerateProviderResult>;
}

export interface TtsVoiceOption {
  id: string;
  locale?: string;
  sample?: string;
}

export const XIAOMI_TTS_VOICES: TtsVoiceOption[] = [
  { id: "mimo_default", sample: "MiMo default voice" },
  { id: "default_zh", locale: "zh_CN", sample: "Chinese female voice" },
  { id: "default_en", locale: "en_US", sample: "English female voice" }
];

export const XIAOMI_TTS_MODELS = ["mimo-v2-tts"] as const;

export function mimeTypeForAudioFormat(format: TtsGenerateFormat): string {
  switch (format) {
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "caf":
      return "audio/x-caf";
    case "aiff":
    default:
      return "audio/aiff";
  }
}
