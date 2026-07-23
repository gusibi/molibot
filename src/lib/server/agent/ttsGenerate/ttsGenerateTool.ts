import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { promises as fs } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { basename, dirname, extname } from "node:path";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { describeFileToolResult, type RunOutputLayout } from "$lib/server/agent/tools/outputLayout.js";
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
  format: Type.Optional(Type.String({ description: "Provider audio format hint. Output is always converted to OGG/Opus when ffmpeg is available." })),
  fileName: Type.Optional(Type.String({ description: "Safe output file name such as narration.ogg. Must not contain directories or path traversal." })),
  autoUpload: Type.Optional(Type.Boolean({ description: "Whether to automatically send the generated audio to the active chat. Defaults to true." }))
});

function buildTtsGenerateDescription(): string {
  return [
    "- Converts text into speech audio using configured TTS providers.",
    "- Supports macOS system voices on macOS and Xiaomi MiMo TTS.",
    "- Output is always converted to OGG/Opus (48kHz, mono, 32kbps) when ffmpeg is available; otherwise falls back to the provider's native format.",
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

/**
 * Check whether ffmpeg is available on the system.
 */
function isFfmpegAvailable(spawnFn: typeof nodeSpawn = nodeSpawn): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawnFn("ffmpeg", ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Convert any audio file to OGG/Opus (48kHz, mono, 32kbps).
 */
function convertToOgg(
  inputPath: string,
  outputPath: string,
  spawnFn: typeof nodeSpawn = nodeSpawn,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-c:a", "libopus",
      "-b:a", "32k",
      "-ar", "48000",
      "-ac", "1",
      "-y",
      outputPath
    ];
    const child: ChildProcess = spawnFn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const onAbort = () => {
      child.kill();
      reject(new Error("OGG conversion aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(`ffmpeg OGG conversion failed: ${stderr.trim().slice(-300) || `exit ${code}`}`));
        return;
      }
      resolve();
    });
  });
}

export function createTtsGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  outputLayout?: RunOutputLayout;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  spawn?: typeof nodeSpawn;
  now?: () => number;
}): AgentTool<typeof ttsGenerateSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);
  const spawnFn = options.spawn ?? nodeSpawn;

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

      // Generate provider-format intermediate file name
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
        spawn: spawnFn,
        signal
      });

      // Write provider output to disk
      let intermediateFilePath = result.outputPath ?? filePath;
      if (result.audioBuffer) {
        intermediateFilePath = result.outputPath ?? filePath;
        await fs.mkdir(dirname(intermediateFilePath), { recursive: true });
        await fs.writeFile(intermediateFilePath, result.audioBuffer);
      }
      // If provider wrote directly (e.g. macOS say), intermediateFilePath is already set

      // Try to convert to OGG/Opus for unified output
      let finalFilePath = intermediateFilePath;
      let finalFileName = basename(intermediateFilePath);
      let finalFormat = result.format;
      let finalMimeType = result.mimeType;
      let oggConversionNote: string | undefined;

      const ffmpegOk = await isFfmpegAvailable(spawnFn).catch(() => false);
      if (ffmpegOk) {
        const oggName = basename(intermediateFilePath, extname(intermediateFilePath)) + ".ogg";
        const oggTarget = routeArtifactPath(oggName, options.artifactDir);
        const oggFilePath = resolveToolPath(options.cwd, oggTarget.path);
        ensureAllowedPath(oggFilePath);

        try {
          await fs.mkdir(dirname(oggFilePath), { recursive: true });
          await convertToOgg(intermediateFilePath, oggFilePath, spawnFn, signal);
          // Clean up intermediate provider-format file
          try { await fs.unlink(intermediateFilePath); } catch {}
          finalFilePath = oggFilePath;
          finalFileName = oggName;
          finalFormat = "ogg" as TtsGenerateFormat;
          finalMimeType = "audio/ogg";
        } catch (conversionError) {
          // Conversion failed — keep the provider-format file
          oggConversionNote = `OGG conversion failed (${conversionError instanceof Error ? conversionError.message : String(conversionError)}), using provider native format.`;
        }
      } else {
        oggConversionNote = "ffmpeg not available; output saved in provider native format. Install ffmpeg for OGG/Opus output.";
      }

      const finalTargetPath = routeArtifactPath(finalFileName, options.artifactDir);

      let uploadError: string | undefined;
      const shouldUpload = params.autoUpload !== false;
      if (shouldUpload && options.uploadFile) {
        try {
          await options.uploadFile(finalFilePath, finalFileName, `Generated speech audio: ${text.slice(0, 120)}`);
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

      return {
        content: [{
          type: "text",
          text: [
            `Successfully generated speech audio using '${provider}' provider.${uploadMessage}`,
            `Voice: ${result.voice}`,
            result.model ? `Model: ${result.model}` : undefined,
            `Saved file to: ${finalTargetPath.path}`,
            oggConversionNote ? `Note: ${oggConversionNote}` : undefined,
            uploadError ? `Upload error: ${uploadError}` : undefined
          ].filter(Boolean).join("\n")
        }],
        details: {
          ...(options.outputLayout
            ? describeFileToolResult(options.outputLayout, finalFilePath, "generated", finalFileName)
            : {}),
          provider,
          voice: result.voice,
          model: result.model,
          format: finalFormat,
          mimeType: finalMimeType,
          path: finalTargetPath.path,
          filePath: finalFilePath,
          uploaded,
          uploadError
        }
      };
    }
  };
}
