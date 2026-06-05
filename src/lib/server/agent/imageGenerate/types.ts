import type { ImageGenerateEngineId, ImageGenerateSettings } from "$lib/server/settings/index.js";

export type ImageGenerateEngine = ImageGenerateEngineId;

export interface ImageGenerateInput {
  prompt: string;
  engine?: ImageGenerateEngine | "auto";
  model?: string;
  size?: string;
  seed?: number;
  images?: string[];
  outputName?: string;
}

export interface ImageGenerateProviderResult {
  imageUrl?: string;
  imageBase64?: string;
  imageBuffer?: Buffer;
}

export interface ImageGenerateProviderContext {
  settings: ImageGenerateSettings;
  fetch: typeof fetch;
  signal?: AbortSignal;
}

export interface ImageGenerateProvider {
  id: ImageGenerateEngine;
  generate(input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult>;
}
