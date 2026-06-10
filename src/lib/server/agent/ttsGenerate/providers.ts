import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { TtsGenerateFormat } from "./types.js";
import {
  mimeTypeForAudioFormat,
  type TtsGenerateInput,
  type TtsGenerateProviderAdapter,
  type TtsGenerateProviderContext,
  type TtsGenerateProviderResult,
  type TtsVoiceOption
} from "./types.js";

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseJsonSafely(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Xiaomi TTS returned non-JSON response.");
  }
}

function normalizeStyleText(text: string, style?: string): string {
  const styleText = String(style ?? "").trim();
  if (!styleText) return text;
  return `<style>${styleText}</style>${text}`;
}

export function parseMacosSayVoices(stdout: string): TtsVoiceOption[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+([\w-]+)\s+#\s*(.*)$/);
      if (!match) return undefined;
      return {
        id: match[1],
        locale: match[2],
        sample: match[3]
      } satisfies TtsVoiceOption;
    })
    .filter((voice): voice is TtsVoiceOption => Boolean(voice));
}

export async function listMacosSayVoices(options: {
  platform?: NodeJS.Platform;
  spawn?: typeof nodeSpawn;
  signal?: AbortSignal;
} = {}): Promise<TtsVoiceOption[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return [];
  const spawn = options.spawn ?? nodeSpawn;
  return await new Promise<TtsVoiceOption[]>((resolve, reject) => {
    const child = spawn("say", ["-v", "?"]);
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      child.kill();
      reject(new Error("macOS voice discovery aborted."));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(`macOS voice discovery failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      resolve(parseMacosSayVoices(stdout));
    });
  });
}

export function createXiaomiTtsProvider(): TtsGenerateProviderAdapter {
  return {
    id: "xiaomi",
    async generate(input: TtsGenerateInput, context: TtsGenerateProviderContext): Promise<TtsGenerateProviderResult> {
      const config = context.settings.providers.xiaomi;
      if (!config.enabled) {
        throw new Error("Xiaomi TTS provider is disabled in settings.");
      }
      if (!config.apiKey.trim()) {
        throw new Error("Xiaomi TTS API key is not configured.");
      }
      const text = input.text.trim();
      if (!text) {
        throw new Error("Text is required for TTS generation.");
      }
      const model = String(input.model ?? config.model ?? "mimo-v2-tts").trim() || "mimo-v2-tts";
      const voice = String(input.voice ?? config.voice ?? "mimo_default").trim() || "mimo_default";
      const format = (input.format ?? config.format ?? "wav") as TtsGenerateFormat;
      const url = `${trimSlash(config.baseUrl || "https://api.xiaomimimo.com/v1")}/chat/completions`;
      const body = {
        model,
        messages: [{ role: "assistant", content: normalizeStyleText(text, input.style) }],
        audio: { format, voice },
        stream: false
      };

      const response = await context.fetch(url, {
        method: "POST",
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: context.signal
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Xiaomi TTS request failed: ${response.status} ${response.statusText} ${responseText.slice(0, 300)}`.trim());
      }
      const json = parseJsonSafely(responseText);
      const audioData = json?.choices?.[0]?.message?.audio?.data;
      if (!audioData || typeof audioData !== "string") {
        throw new Error("Xiaomi TTS response did not include audio data.");
      }

      return {
        audioBuffer: Buffer.from(audioData, "base64"),
        mimeType: mimeTypeForAudioFormat(format),
        extension: format,
        voice,
        model,
        format
      };
    }
  };
}

export function createMacosTtsProvider(): TtsGenerateProviderAdapter {
  return {
    id: "macos",
    async generate(input: TtsGenerateInput, context: TtsGenerateProviderContext): Promise<TtsGenerateProviderResult> {
      if (context.platform !== "darwin") {
        throw new Error("macOS system TTS is only available on macOS.");
      }
      const config = context.settings.providers.macos;
      if (!config.enabled) {
        throw new Error("macOS TTS provider is disabled in settings.");
      }
      const text = input.text.trim();
      if (!text) {
        throw new Error("Text is required for TTS generation.");
      }
      if (!input.outputPath) {
        throw new Error("outputPath is required for macOS TTS generation.");
      }
      const voice = String(input.voice ?? config.voice ?? "").trim();
      const requestedFormat = (input.format ?? config.format ?? "aiff") as TtsGenerateFormat;
      // macOS say does not support wav; fall back to aiff and update the output path extension
      const MACOS_UNSUPPORTED_FORMATS: TtsGenerateFormat[] = ["wav"];
      const format = MACOS_UNSUPPORTED_FORMATS.includes(requestedFormat) ? "aiff" as TtsGenerateFormat : requestedFormat;
      const effectiveOutputPath = requestedFormat !== format
        ? input.outputPath.replace(/\.[^.]+$/, `.${format}`)
        : input.outputPath;
      const args = voice
        ? ["-v", voice, "-o", effectiveOutputPath, "--", text]
        : ["-o", effectiveOutputPath, "--", text];

      await new Promise<void>((resolve, reject) => {
        const child: ChildProcess = context.spawn("say", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        const onAbort = () => {
          child.kill();
          reject(new Error("macOS TTS generation aborted."));
        };
        context.signal?.addEventListener("abort", onAbort, { once: true });
        child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (code) => {
          context.signal?.removeEventListener("abort", onAbort);
          if (code !== 0) {
            reject(new Error(`macOS say failed: ${stderr.trim() || `exit ${code}`}`));
            return;
          }
          resolve();
        });
      });

      return {
        outputPath: effectiveOutputPath,
        mimeType: mimeTypeForAudioFormat(format),
        extension: format,
        voice: voice || "system-default",
        format
      };
    }
  };
}

export const TTS_GENERATE_PROVIDERS = {
  macos: createMacosTtsProvider(),
  xiaomi: createXiaomiTtsProvider()
} as const;
