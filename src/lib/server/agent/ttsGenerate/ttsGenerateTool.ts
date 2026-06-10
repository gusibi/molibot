import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { promises as fs } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { basename, dirname, extname } from "node:path";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { TTS_GENERATE_PROVIDERS } from "./providers.js";
import type { TtsGenerateFormat, TtsGenerateProvider } from "./types.js";

const ttsGenerateSchema = Type.Object({
  text: Type.String({ description: "Text to synthesize into speech audio." }),
  provider: Type.Optional(Type.Union([Type.Literal("macos"), Type.Literal("xiaomi")], {
    description: "TTS provider. Defaults to the provider selected in /settings/tts."
  })),
  voice: Type.Optional(Type.String({ description: "Provider-specific voice ID. Xiaomi examples: mimo_default, default_zh, default_en. macOS examples depend on installed system voices." })),
  model: Type.Optional(Type.String({ description: "Provider-specific model ID. Xiaomi defaults to mimo-v2-tts. macOS has no model concept." })),
  style: Type.Optional(Type.String({ description: "Optional Xiaomi style instruction, inserted as a <style>...</style> prefix. macOS does not support style." })),
  format: Type.Optional(Type.String({ description: "Audio format. Xiaomi defaults to wav; macOS defaults to aiff." })),
  fileName: Type.Optional(Type.String({ description: "Safe output file name such as narration.wav. Must not contain directories or path traversal." })),
  autoUpload: Type.Optional(Type.Boolean({ description: "Whether to automatically send the generated audio to the active chat. Defaults to true." }))
});

function buildTtsGenerateDescription(): string {
  return [
    "- Converts text into speech audio using configured TTS providers.",
    "- Supports macOS system voices on macOS and Xiaomi MiMo TTS.",
    "- Saves the generated audio to the scratch artifact directory and automatically uploads it to the current chat when possible.",
    "",
    "Usage guidelines:",
    "- Use when the user asks to convert text to speech, generate narration, create voiceover audio, or make spoken audio.",
    "- If the user names a voice or provider, pass it explicitly. Otherwise use settings defaults.",
    "- Do not call attach manually after this tool succeeds; automatic upload is enabled by default."
  ].join("\n");
}

function isSafeFileName(fileName: string): boolean {
  const normalized = fileName.trim().replaceAll("\\", "/");
  return Boolean(normalized) &&
    normalized === basename(normalized) &&
    !normalized.startsWith(".") &&
    normalized !== "..";
}

function routeArtifactPath(inputPath: string, artifactDir?: string): { path: string; routed: boolean } {
  const requested = inputPath.trim();
  const normalizedArtifactDir = artifactDir?.trim();
  if (!normalizedArtifactDir || /^\/|^[A-Za-z]:/.test(requested)) {
    return { path: requested, routed: false };
  }
  return { path: `${normalizedArtifactDir}/${requested}`, routed: true };
}

function resolveProvider(settings: RuntimeSettings["ttsGenerate"], requested?: string): TtsGenerateProvider {
  const provider = String(requested ?? settings.defaultProvider).trim() as TtsGenerateProvider;
  if (provider !== "macos" && provider !== "xiaomi") {
    throw new Error(`Unknown TTS provider '${provider}'.`);
  }
  if (!settings.providers[provider].enabled) {
    throw new Error(`TTS provider '${provider}' is disabled in settings.`);
  }
  return provider;
}

function defaultFormatForProvider(settings: RuntimeSettings["ttsGenerate"], provider: TtsGenerateProvider): TtsGenerateFormat {
  return settings.providers[provider].format as TtsGenerateFormat;
}

function defaultOutputName(provider: TtsGenerateProvider, format: TtsGenerateFormat, now: () => number): string {
  return `tts-${now()}-${provider}.${format}`;
}

export function createTtsGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  spawn?: typeof nodeSpawn;
  now?: () => number;
}): AgentTool<typeof ttsGenerateSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    name: "ttsGenerate",
    label: "ttsGenerate",
    description: buildTtsGenerateDescription(),
    parameters: ttsGenerateSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal): Promise<any> => {
      const currentSettings = options.getSettings();
      if (!currentSettings.ttsGenerate.enabled) {
        throw new Error("TTS generation tool is disabled in settings.");
      }

      const text = String(params.text || "").trim();
      if (!text) {
        throw new Error("Text is required.");
      }

      const provider = resolveProvider(currentSettings.ttsGenerate, params.provider);
      const providerConfig = currentSettings.ttsGenerate.providers[provider];
      const format = String(params.format ?? defaultFormatForProvider(currentSettings.ttsGenerate, provider)).trim() as TtsGenerateFormat;
      const rawFileName = String(params.fileName ?? "").trim() || defaultOutputName(provider, format, options.now ?? Date.now);
      if (!isSafeFileName(rawFileName)) {
        throw new Error("fileName must be a safe file name without directories or path traversal.");
      }
      const fileName = extname(rawFileName) ? rawFileName : `${rawFileName}.${format}`;
      const target = routeArtifactPath(fileName, options.artifactDir);
      const filePath = resolveToolPath(options.cwd, target.path);
      ensureAllowedPath(filePath);

      const adapter = TTS_GENERATE_PROVIDERS[provider];
      const result = await adapter.generate({
        text,
        provider,
        voice: params.voice || providerConfig.voice,
        model: provider === "xiaomi" ? (params.model || currentSettings.ttsGenerate.providers.xiaomi.model) : undefined,
        style: params.style,
        format,
        outputPath: filePath
      }, {
        settings: currentSettings.ttsGenerate,
        fetch: options.fetch ?? globalThis.fetch,
        platform: options.platform ?? process.platform,
        spawn: options.spawn ?? nodeSpawn,
        signal
      });

      if (result.audioBuffer) {
        const actualFilePath = result.outputPath ?? filePath;
        await fs.mkdir(dirname(actualFilePath), { recursive: true });
        await fs.writeFile(actualFilePath, result.audioBuffer);
      } else if (result.outputPath && result.outputPath !== filePath) {
        // Provider wrote to a different path (e.g. macOS say changed .wav → .aiff)
      } else if (!result.audioBuffer && result.outputPath === filePath) {
        // Provider wrote directly to filePath, nothing more to do
      }

      const actualFilePath = result.outputPath ?? filePath;
      const actualFileName = basename(actualFilePath);

      let uploadError: string | undefined;
      const shouldUpload = params.autoUpload !== false;
      if (shouldUpload && options.uploadFile) {
        try {
          await options.uploadFile(actualFilePath, actualFileName, `Generated speech audio: ${text.slice(0, 120)}`);
        } catch (error) {
          uploadError = error instanceof Error ? error.message : String(error);
        }
      }
      const uploaded = shouldUpload && Boolean(options.uploadFile) && !uploadError;
      const uploadMessage = uploaded
        ? " (Automatically uploaded and sent to chat channel)"
        : uploadError
          ? " (Generated successfully, but automatic chat upload failed)"
          : "";

      const actualTargetPath = target.routed ? `${options.artifactDir}/${actualFileName}` : actualFileName;

      return {
        content: [{
          type: "text",
          text: [
            `Successfully generated speech audio using '${provider}' provider.${uploadMessage}`,
            `Voice: ${result.voice}`,
            result.model ? `Model: ${result.model}` : undefined,
            `Saved file to: ${actualTargetPath}`,
            result.format !== format ? `Note: format adjusted from ${format} to ${result.format} (provider compatibility)` : undefined,
            uploadError ? `Upload error: ${uploadError}` : undefined
          ].filter(Boolean).join("\n")
        }],
        details: {
          provider,
          voice: result.voice,
          model: result.model,
          format: result.format,
          mimeType: result.mimeType,
          path: actualTargetPath,
          filePath: actualFilePath,
          uploaded,
          uploadError
        }
      };
    }
  };
}
