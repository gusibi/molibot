import type { ImageGenerateEngineId, ImageGenerateProtocol, ImageGenerateSettings } from "$lib/server/settings/index.js";
import type { Usage } from "@earendil-works/pi-ai";

export type ImageGenerateEngine = ImageGenerateEngineId;
export type { ImageGenerateProtocol };

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
  mimeType?: string;
  imageUrl?: string;
  imageBase64?: string;
  imageBuffer?: Buffer;
  images?: Array<{ imageBuffer: Buffer; mimeType: string }>;
  text?: string;
  usage?: Usage;
}

export interface ImageGenerateProviderContext {
  settings: ImageGenerateSettings;
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProviderResult?: (result: Pick<ImageGenerateProviderResult, "text" | "usage">) => void;
}

export interface ImageGenerateProvider {
  id: ImageGenerateEngine;
  generate(input: ImageGenerateInput, context: ImageGenerateProviderContext): Promise<ImageGenerateProviderResult>;
}
