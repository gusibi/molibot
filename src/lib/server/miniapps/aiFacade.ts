import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import fs from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";
import { resolveApiKeyForModel, resolveModelSelection } from "$lib/server/agent/routing/modelRouting.js";
import { resolveSttTarget, transcribeAudioViaConfiguredProvider } from "$lib/server/agent/routing/stt.js";
import { resolveContainedPath } from "$lib/server/miniapps/paths.js";
import { overrideSettingsForModelKey } from "$lib/server/providers/assistantService.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import {
  MiniAppAiError,
  type MiniAppAiCapability,
  type MiniAppAiFacade,
  type MiniAppAiTextResult
} from "$lib/server/miniapps/types.js";

export const MINIAPP_AI_MAX_OUTPUT_TOKENS = 8192;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_SYSTEM_BYTES = 32 * 1024;
const MAX_CALLS_PER_MINUTE = 30;
const MAX_CONCURRENT_CALLS = 2;

interface TextExecutionInput {
  settings: RuntimeSettings;
  prompt: string;
  system?: string;
  maxTokens: number;
  signal?: AbortSignal;
}

interface TextExecutionResult extends MiniAppAiTextResult {
  provider: string;
  model: string;
  api: string;
}

interface CreateFacadeOptions {
  appId: string;
  dataDir: string;
  capabilities: MiniAppAiCapability[];
  getSettings: () => RuntimeSettings;
  usageTracker?: AiUsageTracker;
  executeText?: (input: TextExecutionInput) => Promise<TextExecutionResult>;
}

function textFromMessage(message: AssistantMessage): string {
  return message.content
    .filter((item): item is Extract<AssistantMessage["content"][number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("");
}

async function executeTextWithProvider(input: TextExecutionInput): Promise<TextExecutionResult> {
  const selection = resolveModelSelection(input.settings, "text");
  const apiKey = await resolveApiKeyForModel(selection.model, input.settings);
  if (!apiKey) throw new MiniAppAiError("capability_unavailable", "Text generation is not configured.");
  const context: Context = {
    ...(input.system ? { systemPrompt: input.system } : {}),
    messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
    tools: []
  };
  const message = await completeSimple(selection.model, context, {
    apiKey,
    maxTokens: input.maxTokens,
    signal: input.signal,
    reasoning: "off"
  });
  if (message.stopReason === "aborted") throw new MiniAppAiError("aborted", "The AI request was aborted.");
  if (message.stopReason === "error") throw new MiniAppAiError("provider_failed", "The AI provider could not complete the request.");
  return {
    text: textFromMessage(message),
    usage: {
      inputTokens: message.usage.input,
      outputTokens: message.usage.output,
      totalTokens: message.usage.totalTokens
    },
    provider: message.provider,
    model: message.model,
    api: message.api
  };
}

function validateTextInput(input: Parameters<MiniAppAiFacade["generateText"]>[0]): { prompt: string; system?: string; maxTokens: number; signal?: AbortSignal } {
  if (!input || typeof input !== "object" || typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw new MiniAppAiError("invalid_request", "prompt must be a non-empty string.");
  }
  if (Buffer.byteLength(input.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new MiniAppAiError("invalid_request", "prompt exceeds the 64 KiB limit.");
  }
  if (input.system !== undefined && typeof input.system !== "string") {
    throw new MiniAppAiError("invalid_request", "system must be a string.");
  }
  if (input.system && Buffer.byteLength(input.system, "utf8") > MAX_SYSTEM_BYTES) {
    throw new MiniAppAiError("invalid_request", "system exceeds the 32 KiB limit.");
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new MiniAppAiError("invalid_request", "signal must be an AbortSignal.");
  }
  const requested = input.maxTokens ?? 1024;
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new MiniAppAiError("invalid_request", "maxTokens must be positive.");
  }
  return {
    prompt: input.prompt,
    ...(input.system ? { system: input.system } : {}),
    maxTokens: Math.min(MINIAPP_AI_MAX_OUTPUT_TOKENS, Math.floor(requested)),
    ...(input.signal ? { signal: input.signal } : {})
  };
}

export function createMiniAppAiFacade(options: CreateFacadeOptions): MiniAppAiFacade {
  let inFlight = 0;
  const starts: number[] = [];
  const executeText = options.executeText ?? executeTextWithProvider;

  function enterLimit(): void {
    const now = Date.now();
    while (starts.length > 0 && starts[0] <= now - 60_000) starts.shift();
    if (inFlight >= MAX_CONCURRENT_CALLS || starts.length >= MAX_CALLS_PER_MINUTE) {
      throw new MiniAppAiError("rate_limited", "This Mini App is making AI requests too quickly.");
    }
    starts.push(now);
    inFlight += 1;
  }

  async function generateText(input: Parameters<MiniAppAiFacade["generateText"]>[0]): Promise<MiniAppAiTextResult> {
    if (!options.capabilities.includes("text")) {
      throw new MiniAppAiError("capability_not_declared", "This Mini App did not declare text generation.");
    }
    const validated = validateTextInput(input);
    if (validated.signal?.aborted) throw new MiniAppAiError("aborted", "The AI request was aborted.");
    enterLimit();
    const startedAt = Date.now();
    try {
      const current = options.getSettings();
      const settings = overrideSettingsForModelKey(current, current.plugins.miniApps.ai.textModelKey);
      const result = await executeText({ settings, ...validated });
      options.usageTracker?.record({
        channel: "miniapp",
        botId: "miniapp",
        appId: options.appId,
        capability: "text",
        status: "success",
        durationMs: Date.now() - startedAt,
        provider: result.provider,
        model: result.model,
        api: result.api,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens
      });
      return { text: result.text, usage: result.usage };
    } catch (cause) {
      const error = cause instanceof MiniAppAiError
        ? cause
        : validated.signal?.aborted
          ? new MiniAppAiError("aborted", "The AI request was aborted.")
          : new MiniAppAiError("provider_failed", "The AI provider could not complete the request.");
      options.usageTracker?.record({
        channel: "miniapp",
        botId: "miniapp",
        appId: options.appId,
        capability: "text",
        status: "error",
        durationMs: Date.now() - startedAt,
        errorCode: error.code,
        provider: "unknown",
        model: "unknown",
        api: "unknown"
      });
      throw error;
    } finally {
      inFlight -= 1;
    }
  }

  return {
    generateText,
    async transcribe(input) {
      if (!options.capabilities.includes("transcription")) {
        throw new MiniAppAiError("capability_not_declared", "This Mini App did not declare transcription.");
      }
      if (!input || typeof input.path !== "string" || !input.path.trim()) {
        throw new MiniAppAiError("invalid_request", "path must name an audio file in this Mini App's data directory.");
      }
      if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
        throw new MiniAppAiError("invalid_request", "signal must be an AbortSignal.");
      }
      if (input.signal?.aborted) throw new MiniAppAiError("aborted", "The AI request was aborted.");
      let language: string | undefined;
      if (input.language !== undefined) {
        if (typeof input.language !== "string") throw new MiniAppAiError("invalid_request", "language must be a BCP-47 tag.");
        try {
          language = new Intl.Locale(input.language).toString();
        } catch {
          throw new MiniAppAiError("invalid_request", "language must be a BCP-47 tag.");
        }
      }
      const audioPath = resolveContainedPath(options.dataDir, input.path, { requireFile: true });
      if (!audioPath) throw new MiniAppAiError("invalid_request", "Audio file is unavailable.");
      const stats = fs.statSync(audioPath);
      if (stats.size > 25 * 1024 * 1024) throw new MiniAppAiError("invalid_request", "Audio exceeds the 25 MiB limit.");
      let durationSeconds = 0;
      try {
        const metadata = await parseFile(audioPath, { duration: true });
        durationSeconds = Number(metadata.format.duration ?? 0);
      } catch {
        throw new MiniAppAiError("invalid_request", "Audio format is invalid or unsupported.");
      }
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 600) {
        throw new MiniAppAiError("invalid_request", "Audio duration must be between 0 and 10 minutes.");
      }
      const mimeByExtension: Record<string, string> = {
        ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
        ".mp4": "audio/mp4", ".wav": "audio/wav", ".flac": "audio/flac"
      };
      const mimeType = mimeByExtension[path.extname(audioPath).toLowerCase()];
      if (!mimeType) throw new MiniAppAiError("invalid_request", "Audio format is invalid or unsupported.");
      enterLimit();
      const startedAt = Date.now();
      try {
        const current = options.getSettings();
        const routeKey = current.plugins.miniApps.ai.transcriptionModelKey;
        const settings = routeKey
          ? { ...current, modelRouting: { ...current.modelRouting, sttModelKey: routeKey } }
          : current;
        const target = resolveSttTarget(settings);
        if (!target) {
          throw new MiniAppAiError("capability_unavailable", "Transcription is not configured.");
        }
        const result = await transcribeAudioViaConfiguredProvider({
          channel: "miniapp",
          settings,
          data: fs.readFileSync(audioPath),
          filename: path.basename(audioPath),
          mimeType,
          maxAttempts: 1,
          signal: input.signal,
          language,
          metadata: { appId: options.appId, capability: "transcription" }
        });
        if (!result.text) throw new MiniAppAiError("provider_failed", "The transcription provider could not complete the request.");
        options.usageTracker?.record({
          channel: "miniapp", botId: "miniapp", appId: options.appId, capability: "transcription",
          status: "success", durationMs: Date.now() - startedAt, audioSeconds: durationSeconds,
          provider: target.providerId, model: target.model, api: "audio-transcriptions"
        });
        return { text: result.text, durationSeconds };
      } catch (cause) {
        const error = cause instanceof MiniAppAiError
          ? cause
          : input.signal?.aborted
            ? new MiniAppAiError("aborted", "The AI request was aborted.")
            : new MiniAppAiError("provider_failed", "The transcription provider could not complete the request.");
        options.usageTracker?.record({
          channel: "miniapp", botId: "miniapp", appId: options.appId, capability: "transcription",
          status: "error", durationMs: Date.now() - startedAt, audioSeconds: durationSeconds, errorCode: error.code,
          provider: "unknown", model: "unknown", api: "audio-transcriptions"
        });
        throw error;
      } finally {
        inFlight -= 1;
      }
    }
  };
}
