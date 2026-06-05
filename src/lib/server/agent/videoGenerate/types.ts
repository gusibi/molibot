import type { VideoGenerateEngineId, VideoGenerateSettings } from "$lib/server/settings/index.js";

export type VideoGenerateEngine = VideoGenerateEngineId;

export interface VideoGenerateInput {
  prompt: string;
  engine?: VideoGenerateEngine | "auto";
  model?: string;
  duration?: number;
  ratio?: string;
  seed?: number;
  images?: string[];
  generateAudio?: boolean;
  watermark?: boolean;
  outputName?: string;
}

export interface VideoGenerateProviderResult {
  videoUrl?: string;
  videoBuffer?: Buffer;
}

export interface VideoGenerateProviderContext {
  settings: VideoGenerateSettings;
  fetch: typeof fetch;
  signal?: AbortSignal;
}

export interface VideoGenerateProvider {
  id: VideoGenerateEngine;
  generate(input: VideoGenerateInput, context: VideoGenerateProviderContext): Promise<VideoGenerateProviderResult>;
}
