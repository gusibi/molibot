import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { RuntimeSettings } from "../settings/index.js";
import type { MemoryGateway } from "../memory/gateway.js";
import { currentModelKey } from "../settings/modelSwitch.js";
import {
  buildOpenAIBaseUrl,
  getCustomProviderById,
  getProviderModel,
  getSelectedCustomProvider,
  isOAuthProvider,
  parseModelKey,
  resolveApiKeyForProviderRuntime,
  resolveApiKeyForModelRuntime,
  resolveModel,
  resolveModelSelection,
  type ResolvedModelSelection,
  validateAiProviderSettings
} from "../providers/modelResolver.js";
import { momError, momLog, momWarn } from "./log.js";
import { buildSystemPrompt } from "./prompt.js";
import { MomRuntimeStore } from "./store.js";
import { resolveSttTarget, transcribeAudioViaConfiguredProvider } from "./stt.js";
import { createMomTools } from "./tools/index.js";
import type { MomContext, RunResult, RunnerLike } from "./types.js";
import type { AiUsageTracker } from "../usage/tracker.js";

function getCustomModelRoles(settings: RuntimeSettings): string[] {
  const routed = parseModelKey(settings.modelRouting.textModelKey);
  if (routed?.mode === "custom") {
    const provider = getCustomProviderById(settings, routed.provider);
    const model = provider?.models.find((m) => m.id === routed.model);
    if (model?.supportedRoles?.length) return model.supportedRoles;
  }

  const selected = getSelectedCustomProvider(settings);
  if (!selected) return [];
  const modelId = getProviderModel(selected);
  const model = selected.models.find((m) => m.id === modelId);
  return model?.supportedRoles ?? [];
}

function supportsVisionNatively(
  selection: ResolvedModelSelection
): boolean {
  if (selection.source === "custom") {
    return Boolean(
      selection.configuredModel?.tags?.includes("vision") &&
      selection.configuredModel?.verification?.vision === "passed"
    );
  }
  return Array.isArray(selection.model.input) && selection.model.input.includes("image");
}

function supportsAudioInputConfigured(
  selection: ResolvedModelSelection
): boolean {
  if (selection.source !== "custom") return false;
  return Boolean(
    selection.configuredModel?.tags?.includes("audio_input") &&
    selection.configuredModel?.verification?.audio_input === "passed"
  );
}

function decideVisionRouting(settings: RuntimeSettings, hasImages: boolean): {
  selection: ResolvedModelSelection;
  sendImagesNatively: boolean;
  mode: "text" | "vision" | "fallback";
  reason: string;
} {
  const textSelection = resolveModelSelection(settings, "text");
  if (!hasImages) {
    return {
      selection: textSelection,
      sendImagesNatively: false,
      mode: "text",
      reason: "no_images"
    };
  }

  if (supportsVisionNatively(textSelection)) {
    return {
      selection: textSelection,
      sendImagesNatively: true,
      mode: "text",
      reason: "text_model_verified_vision"
    };
  }

  const visionSelection = resolveModelSelection(settings, "vision");
  if (supportsVisionNatively(visionSelection)) {
    return {
      selection: visionSelection,
      sendImagesNatively: true,
      mode: "vision",
      reason: "vision_route_verified"
    };
  }

  return {
    selection: textSelection,
    sendImagesNatively: false,
    mode: "fallback",
    reason: "no_verified_native_vision"
  };
}

function decideAudioRouting(settings: RuntimeSettings, hasAudio: boolean): {
  shouldTranscribe: boolean;
  mode: "none" | "stt" | "fallback";
  reason: string;
  userNotice?: string;
} {
  if (!hasAudio) {
    return {
      shouldTranscribe: false,
      mode: "none",
      reason: "no_audio"
    };
  }

  const textSelection = resolveModelSelection(settings, "text");
  const nativeAudioConfigured = supportsAudioInputConfigured(textSelection);
  const sttTarget = resolveSttTarget(settings);

  if (nativeAudioConfigured && sttTarget) {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "audio_input_verified_but_transport_unavailable"
    };
  }

  if (nativeAudioConfigured && !sttTarget) {
    return {
      shouldTranscribe: false,
      mode: "fallback",
      reason: "audio_input_verified_but_no_stt_fallback",
      userNotice: "当前主模型已声明并验证 `audio_input`，但 runtime 还不支持原生音频直传，且未配置可用的 STT 模型。"
    };
  }

  if (sttTarget?.declared && sttTarget.verification === "passed") {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "stt_route_verified"
    };
  }

  if (sttTarget?.declared && (sttTarget.verification === "untested" || sttTarget.verification === "missing")) {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "stt_route_declared_unverified"
    };
  }

  if (sttTarget) {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "builtin_stt_fallback"
    };
  }

  return {
    shouldTranscribe: false,
    mode: "fallback",
    reason: "no_stt_target",
    userNotice: "收到语音消息，但当前没有可用的 STT 路由；系统将保留语音占位文本而不做转写。"
  };
}

function redactBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.replace(/\/\/([^/@]+)@/, "//***@");
}

function keyFingerprint(key: string | undefined): string {
  if (!key) return "none";
  if (key.length <= 8) return `len=${key.length}`;
  return `${key.slice(0, 4)}...${key.slice(-2)}(len=${key.length})`;
}

function extractTextFromResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const obj = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(obj.content)) return JSON.stringify(result);
  const parts = obj.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
  return parts.join("\n") || JSON.stringify(result);
}

function normalizeAudioMimeType(mimeType?: string | null): string {
  const value = String(mimeType || "").toLowerCase().trim();
  if (!value || value === "application/octet-stream") return "audio/ogg";
  if (value.includes("opus")) return "audio/ogg";
  if (value.includes("ogg")) return "audio/ogg";
  if (value.includes("mpeg") || value.includes("mp3")) return "audio/mpeg";
  if (value.includes("wav")) return "audio/wav";
  if (value.includes("mp4") || value.includes("m4a")) return "audio/mp4";
  if (value.includes("aac")) return "audio/aac";
  if (value.includes("webm")) return "audio/webm";
  if (value.includes("flac")) return "audio/flac";
  return "audio/ogg";
}

function resolveAudioExt(mimeType?: string | null): string {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("opus")) return ".opus";
  if (value.includes("ogg")) return ".ogg";
  if (value.includes("mpeg") || value.includes("mp3")) return ".mp3";
  if (value.includes("wav")) return ".wav";
  if (value.includes("mp4") || value.includes("m4a")) return ".m4a";
  if (value.includes("aac")) return ".aac";
  if (value.includes("webm")) return ".webm";
  if (value.includes("flac")) return ".flac";
  return ".ogg";
}

function ensureAudioFilename(filename: string, mimeType?: string | null): string {
  const trimmed = filename.trim() || "audio-message";
  const lower = trimmed.toLowerCase();
  if (/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|opus|wav|webm|aac)$/.test(lower)) {
    return trimmed;
  }
  return `${trimmed}${resolveAudioExt(mimeType)}`;
}

async function enrichMessageTextWithAudio(
  ctx: MomContext,
  settings: RuntimeSettings,
  audioDecision: { shouldTranscribe: boolean; reason: string; userNotice?: string }
): Promise<{
  text: string;
  transcriptionErrors: string[];
}> {
  const audioAttachments = ctx.message.attachments.filter((item) => item.isAudio);
  if (audioAttachments.length === 0) {
    return { text: ctx.message.text, transcriptionErrors: [] };
  }

  if (!audioDecision.shouldTranscribe) {
    return {
      text: ctx.message.text,
      transcriptionErrors: audioDecision.userNotice ? [audioDecision.userNotice] : []
    };
  }

  const transcripts: string[] = [];
  const transcriptionErrors: string[] = [];

  for (const attachment of audioAttachments) {
    const fullPath = join(ctx.workspaceDir, attachment.local);
    let data: Buffer;
    try {
      data = readFileSync(fullPath);
    } catch (error) {
      transcriptionErrors.push(
        `无法读取语音附件 ${attachment.original}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const mimeType = normalizeAudioMimeType(attachment.mimeType);
    const filename = ensureAudioFilename(attachment.original, mimeType);
    const transcription = await transcribeAudioViaConfiguredProvider({
      channel: ctx.channel,
      settings,
      data,
      filename,
      mimeType,
      maxAttempts: 3,
      retryDelayMs: 800
    });

    if (transcription.text) {
      transcripts.push(transcription.text);
    } else if (transcription.errorMessage) {
      transcriptionErrors.push(transcription.errorMessage);
    }
  }

  let text = ctx.message.text;
  if (transcripts.length > 0) {
    const transcriptSection = `[voice transcript]\n${transcripts.join("\n\n")}`;
    text = text.trim()
      ? `${text}\n\n${transcriptSection}`
      : transcriptSection;
  } else if (!text.trim()) {
    text = "(voice message received; transcription unavailable)";
  }

  return { text, transcriptionErrors };
}

function mapUnsupportedDeveloperRole(
  settings: RuntimeSettings,
  context: any,
): any {
  const routed = parseModelKey(settings.modelRouting.textModelKey);
  const shouldCheckCustom = settings.providerMode === "custom" || routed?.mode === "custom";
  if (!shouldCheckCustom) return context;
  const roles = getCustomModelRoles(settings);
  if (roles.includes("developer")) return context;

  if (
    !context ||
    typeof context !== "object" ||
    !Array.isArray(context.messages)
  )
    return context;
  const mappedMessages = context.messages.map((msg: any) => {
    if (!msg || typeof msg !== "object") return msg;
    if (msg.role !== "developer") return msg;
    return { ...msg, role: "system" };
  });

  // For some OpenAI-compatible adapters, systemPrompt can be emitted as a "developer" message.
  // Move it into explicit system message to force compatible role shape.
  const prompt =
    typeof context.systemPrompt === "string" ? context.systemPrompt.trim() : "";
  if (!prompt) {
    return { ...context, messages: mappedMessages };
  }

  return {
    ...context,
    systemPrompt: "",
    messages: [{ role: "system", content: prompt }, ...mappedMessages],
  };
}

function supportsVisionForStreamModel(settings: RuntimeSettings, selectedModel: { provider?: string; id?: string; input?: string[] }): boolean {
  const providerId = String(selectedModel?.provider ?? "").trim();
  const modelId = String(selectedModel?.id ?? "").trim();
  if (!providerId || !modelId) {
    return Array.isArray(selectedModel?.input) && selectedModel.input.includes("image");
  }

  const customProvider = getCustomProviderById(settings, providerId);
  if (!customProvider) {
    return Array.isArray(selectedModel?.input) && selectedModel.input.includes("image");
  }

  const configuredModel = customProvider.models.find((model) => model.id === modelId);
  if (!configuredModel) return false;
  return Boolean(
    configuredModel.tags?.includes("vision") &&
    configuredModel.verification?.vision === "passed"
  );
}

function stripUnsupportedImagePartsFromContext(context: any): {
  context: any;
  removedParts: number;
  touchedMessages: number;
} {
  if (!context || typeof context !== "object" || !Array.isArray(context.messages)) {
    return { context, removedParts: 0, touchedMessages: 0 };
  }

  let removedParts = 0;
  let touchedMessages = 0;
  const messages = context.messages.map((msg: any) => {
    if (!msg || typeof msg !== "object") return msg;
    if (!Array.isArray(msg.content)) return msg;

    const kept = msg.content.filter((part: any) => {
      if (!part || typeof part !== "object") return true;
      const type = String(part.type ?? "").toLowerCase();
      if (type === "image" || type === "input_image" || type === "image_url") return false;
      if (part.image_url) return false;
      return true;
    });

    const removed = msg.content.length - kept.length;
    if (removed <= 0) return msg;
    removedParts += removed;
    touchedMessages += 1;

    if (kept.length > 0) return { ...msg, content: kept };
    return {
      ...msg,
      content: "(history image omitted because current model does not support vision)"
    };
  });

  return {
    context: { ...context, messages },
    removedParts,
    touchedMessages
  };
}

export class MomRunner implements RunnerLike {
  private readonly agent: Agent;
  private running = false;

  constructor(
    private readonly channel: string,
    private readonly chatId: string,
    private readonly sessionId: string,
    private readonly store: MomRuntimeStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    private readonly usageTracker: AiUsageTracker,
    private readonly memory: MemoryGateway,
  ) {
    const settings = this.getSettings();
    const model = resolveModel(settings, "text");
    const initialPrompt = buildSystemPrompt(
      this.store.getWorkspaceDir(),
      this.chatId,
      this.sessionId,
      "(memory will be loaded via gateway before each run)",
      {
        channel: this.channel as "telegram" | "feishu",
        timezone: settings.timezone,
        settings
      },
    );

    this.agent = new Agent({
      initialState: {
        systemPrompt: initialPrompt,
        model,
        thinkingLevel: "off",
        tools: [],
      },
      streamFn: (selectedModel, context, opts) => {
        const settingsNow = this.getSettings();
        const rolePatchedContext = mapUnsupportedDeveloperRole(
          settingsNow,
          context,
        );
        const allowImageContent = supportsVisionForStreamModel(settingsNow, selectedModel as any);
        const imagePatched = allowImageContent
          ? { context: rolePatchedContext, removedParts: 0, touchedMessages: 0 }
          : stripUnsupportedImagePartsFromContext(rolePatchedContext);
        const patchedContext = imagePatched.context;
        momLog("runner", "llm_stream_start", {
          chatId: this.chatId,
          provider: selectedModel.provider,
          api: selectedModel.api,
          modelId: selectedModel.id,
          baseUrl: redactBaseUrl(selectedModel.baseUrl),
          messageCount: patchedContext.messages.length,
          hasSystemPrompt: Boolean(patchedContext.systemPrompt),
          hasTools:
            Array.isArray(patchedContext.tools) &&
            patchedContext.tools.length > 0,
          allowImageContent,
          strippedImageParts: imagePatched.removedParts,
          strippedImageMessages: imagePatched.touchedMessages
        });
        return streamSimple(
          selectedModel as any,
          patchedContext as any,
          opts as any,
        );
      },
      getApiKey: async (provider: string) => {
        const settingsNow = this.getSettings();
        const selectedCustom = getCustomProviderById(settingsNow, provider);
        const key = await resolveApiKeyForProviderRuntime(provider, settingsNow);
        momLog("runner", "api_key_resolve", {
          chatId: this.chatId,
          provider,
          providerMode: settingsNow.providerMode,
          hasKey: Boolean(key),
          keyFingerprint: keyFingerprint(key),
          customProviderId: selectedCustom?.id
        });
        return key;
      },
    });

    const saved = this.store.loadContext(this.chatId, this.sessionId);
    if (saved.length > 0) {
      this.agent.replaceMessages(saved);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  abort(): void {
    this.agent.abort();
  }

  async run(ctx: MomContext): Promise<RunResult> {
    const runId =
      (ctx.message as { runId?: string }).runId ??
      `${this.chatId}-${this.sessionId}-${ctx.message.messageId}`;
    this.running = true;
    momLog("runner", "run_start", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      messageId: ctx.message.messageId,
      textLength: ctx.message.text.length,
      attachments: ctx.message.attachments.length,
      images: ctx.message.imageContents.length,
      isEvent: Boolean(ctx.message.isEvent),
    });

    const queue: Array<() => Promise<void>> = [];
    let queueRunning = false;
    const enqueue = (job: () => Promise<void>): void => {
      queue.push(job);
      if (!queueRunning) {
        void runQueue();
      }
    };

    const runQueue = async (): Promise<void> => {
      queueRunning = true;
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) continue;
        try {
          await job();
        } catch {
          // ignore UI update errors
        }
      }
      queueRunning = false;
    };

    const settings = this.getSettings();
    const settingsError = validateAiProviderSettings(settings);
    if (settingsError) {
      momWarn("runner", "settings_error", {
        runId,
        chatId: this.chatId,
        settingsError,
      });
      await ctx.setTyping(true);
      await ctx.setWorking(false);
      await ctx.replaceMessage(settingsError);
      return { stopReason: "error", errorMessage: settingsError };
    }

    const audioDecision = decideAudioRouting(
      settings,
      ctx.message.attachments.some((item) => item.isAudio)
    );
    momLog("runner", "audio_route_decision", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      mode: audioDecision.mode,
      reason: audioDecision.reason,
      audioRouteKey: currentModelKey(settings, "stt"),
      hasAudioInput: ctx.message.attachments.some((item) => item.isAudio),
    });

    const enrichedInput = await enrichMessageTextWithAudio(ctx, settings, audioDecision);
    if (enrichedInput.transcriptionErrors.length > 0) {
      await ctx.respondInThread(
        [
          "语音识别失败，已降级为未转写消息。",
          ...enrichedInput.transcriptionErrors,
          "建议：检查 STT provider 的 baseUrl/path/model 是否正确。"
        ].join("\n")
      );
    }

    const visionDecision = decideVisionRouting(
      settings,
      Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0
    );
    const selectedModel = visionDecision.selection.model;
    const selectedCustom = settings.customProviders.find((p) => p.id === selectedModel.provider);
    const resolvedKey = await resolveApiKeyForModelRuntime(selectedModel, settings);
    if (!resolvedKey) {
      const oauthHint = isOAuthProvider(selectedModel.provider)
        ? " For OAuth providers, run `npx @mariozechner/pi-ai login <provider>` and place `auth.json` under `${DATA_DIR}` (or set `PI_AI_AUTH_FILE`)."
        : "";
      const keyError =
        `AI settings error: missing API key for active model provider '${selectedModel.provider}'. ` +
        `Please check current model routing and provider key configuration.${oauthHint}`;
      momWarn("runner", "active_model_missing_api_key", {
        runId,
        chatId: this.chatId,
        providerMode: settings.providerMode,
        modelProvider: selectedModel.provider,
        modelId: selectedModel.id
      });
      await ctx.setTyping(true);
      await ctx.setWorking(false);
      await ctx.replaceMessage(keyError);
      return { stopReason: "error", errorMessage: keyError };
    }
    this.agent.setModel(selectedModel);
    momLog("runner", "model_selected", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      providerMode: settings.providerMode,
      modelProvider: selectedModel.provider,
      modelId: selectedModel.id,
      modelApi: selectedModel.api,
      modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
      customProviderId: selectedCustom?.id,
      customProviderName: selectedCustom?.name,
      customProviderPath: selectedCustom?.path,
      customProviderComputedBaseUrl: selectedCustom?.baseUrl?.trim()
        ? redactBaseUrl(
          buildOpenAIBaseUrl(selectedCustom.baseUrl, selectedCustom.path),
        )
        : undefined,
      visionRoutingMode: visionDecision.mode,
      visionRoutingReason: visionDecision.reason,
      nativeVisionEnabled: visionDecision.sendImagesNatively,
      visionRouteKey: currentModelKey(settings, "vision"),
      audioRoutingMode: audioDecision.mode,
      audioRoutingReason: audioDecision.reason,
      sttRouteKey: currentModelKey(settings, "stt"),
      hasApiKey: Boolean(resolvedKey),
      apiKeyFingerprint: keyFingerprint(resolvedKey),
    });
    await this.memory.syncExternalMemories();
    const memoryText =
      (await this.memory.buildPromptContext(
        { channel: this.channel, externalUserId: this.chatId },
        enrichedInput.text,
        12,
      )) || "(no working memory yet)";
    this.agent.setSystemPrompt(
      buildSystemPrompt(
        this.store.getWorkspaceDir(),
        this.chatId,
        this.sessionId,
        memoryText,
        {
          channel: this.channel as "telegram" | "feishu",
          timezone: settings.timezone,
          settings
        },
      ),
    );

    this.agent.setTools(
      createMomTools({
        channel: ctx.channel,
        cwd: this.store.getScratchDir(this.chatId),
        workspaceDir: this.store.getWorkspaceDir(),
        chatId: this.chatId,
        timezone: settings.timezone,
        memory: this.memory,
        getSettings: this.getSettings,
        updateSettings: this.updateSettings,
        uploadFile: async (filePath, title) => {
          await ctx.uploadFile(filePath, title);
        },
      }),
    );

    let stopReason: "stop" | "aborted" | "error" = "stop";
    let errorMessage: string | undefined;

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      if (event.type === "tool_execution_start") {
        const args = event.args as { label?: string };
        const label = args.label || event.toolName;
        momLog("runner", "tool_start", {
          runId,
          chatId: this.chatId,
          tool: event.toolName,
          label,
        });
        enqueue(() => ctx.respond(`_→ ${label}_`, false));
      }

      if (event.type === "tool_execution_end") {
        const body = extractTextFromResult(event.result);
        const status = event.isError ? "✗" : "✓";
        momLog("runner", "tool_end", {
          runId,
          chatId: this.chatId,
          tool: event.toolName,
          isError: event.isError,
          resultPreview: body.slice(0, 160),
        });
        const text = `*${status} ${event.toolName}*\n\`\`\`\n${body}\n\`\`\``;
        if (event.isError) {
          enqueue(() => ctx.respondInThread(text));
          enqueue(() => ctx.respond(`_Error: ${body.slice(0, 200)}_`, false));
        }
      }

      if (
        event.type === "message_end" &&
        (event.message as { role?: string }).role === "assistant"
      ) {
        const msg = event.message as {
          stopReason?: "stop" | "aborted" | "error";
          errorMessage?: string;
          content?: Array<{ type: string; text?: string }>;
          api?: string;
          provider?: string;
          model?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            totalTokens?: number;
          };
        };
        if (msg.stopReason) stopReason = msg.stopReason;
        if (msg.errorMessage) errorMessage = msg.errorMessage;
        if (msg.errorMessage) {
          momWarn("runner", "assistant_error_message", {
            runId,
            chatId: this.chatId,
            errorMessage: msg.errorMessage,
          });
        }
        momLog("runner", "assistant_message_end", {
          runId,
          chatId: this.chatId,
          stopReason: msg.stopReason,
          api: msg.api,
          provider: msg.provider,
          model: msg.model,
          contentCount: Array.isArray(msg.content) ? msg.content.length : 0,
          usage: msg.usage,
        });
        if (msg.usage) {
          this.usageTracker.record({
            channel: this.channel,
            provider: msg.provider ?? selectedModel.provider,
            model: msg.model ?? selectedModel.id,
            api: msg.api ?? selectedModel.api,
            inputTokens: msg.usage.input,
            outputTokens: msg.usage.output,
            cacheReadTokens: msg.usage.cacheRead,
            cacheWriteTokens: msg.usage.cacheWrite,
            totalTokens: msg.usage.totalTokens
          });
        }

        const text = (msg.content || [])
          .filter(
            (part) => part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text as string)
          .join("\n");

        if (text.trim()) {
          momLog("runner", "assistant_text_chunk", {
            runId,
            chatId: this.chatId,
            textLength: text.length,
          });
          enqueue(() => ctx.respond(text));
        }
      }
    });

    const MAX_EMPTY_RETRIES = 2;

    try {
      await ctx.setTyping(true);
      await ctx.setWorking(true);

      const now = new Date();
      const timestamp = now.toISOString();

      let userMessage = `[${timestamp}] [${ctx.message.userName || ctx.message.userId}]: ${enrichedInput.text}`;
      const nonImage = ctx.message.attachments
        .filter((a) => !a.isImage || !visionDecision.sendImagesNatively)
        .map((a) => `${ctx.workspaceDir}/${a.local}`);
      if (nonImage.length > 0) {
          userMessage += `\n\n<channel_attachments>\n${nonImage.join("\n")}\n</channel_attachments>`;
      }

      let finalText = "";
      let attemptCount = 0;

      while (attemptCount <= MAX_EMPTY_RETRIES) {
        if (attemptCount > 0) {
          momWarn("runner", "empty_response_retry", {
            runId,
            chatId: this.chatId,
            attempt: attemptCount,
          });
          // Brief delay before retry
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        momLog("runner", "prompt_start", {
          runId,
          chatId: this.chatId,
          promptLength: userMessage.length,
          imageCount: visionDecision.sendImagesNatively ? ctx.message.imageContents.length : 0,
          rawImageCount: ctx.message.imageContents.length,
          visionRoutingMode: visionDecision.mode,
          attempt: attemptCount,
        });
        await this.agent.prompt(
          userMessage,
          visionDecision.sendImagesNatively && ctx.message.imageContents.length > 0
            ? ctx.message.imageContents
            : undefined,
        );
        momLog("runner", "prompt_end", {
          runId,
          chatId: this.chatId,
          stopReason,
          attempt: attemptCount,
        });

        while (queueRunning || queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        momLog("runner", "queue_flushed", { runId, chatId: this.chatId, attempt: attemptCount });

        const messages = this.agent.state.messages as AgentMessage[];
        const sessionContextFile = `${this.store.getWorkspaceDir()}/${this.chatId}/contexts/${this.sessionId}.json`;
        this.store.saveContext(this.chatId, messages, this.sessionId);
        momLog("runner", "context_saved", {
          runId,
          chatId: this.chatId,
          sessionId: this.sessionId,
          sessionContextFile,
          messageCount: messages.length,
        });

        const lastAssistant = [...messages]
          .reverse()
          .find((item) => (item as { role?: string }).role === "assistant") as
          | { content?: Array<{ type: string; text?: string }> }
          | undefined;

        finalText = (lastAssistant?.content || [])
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text as string)
          .join("\n")
          .trim();
        const lastAssistantContentCount = Array.isArray(lastAssistant?.content)
          ? lastAssistant.content.length
          : 0;
        momLog("runner", "final_text_evaluated", {
          runId,
          chatId: this.chatId,
          finalTextLength: finalText.length,
          lastAssistantContentCount,
          attempt: attemptCount,
        });

        // If we got a non-empty response, break out of retry loop
        if (finalText) break;

        attemptCount++;
      }

      if (finalText.startsWith("[SILENT]")) {
        momLog("runner", "final_silent", { runId, chatId: this.chatId });
        await ctx.deleteMessage();
      } else if (finalText) {
        momLog("runner", "final_replace", {
          runId,
          chatId: this.chatId,
          finalTextLength: finalText.length,
        });
        await ctx.replaceMessage(finalText);
      } else {
        const modelInfo = [
          `provider: ${selectedModel.provider}`,
          `model: ${selectedModel.id}`,
          selectedModel.baseUrl ? `baseUrl: ${redactBaseUrl(selectedModel.baseUrl)}` : null,
        ].filter(Boolean).join(", ");
        const emptyResponseMessage =
          `Model returned empty response after ${attemptCount} attempt(s). ` +
          `(${modelInfo}) — Please check baseUrl/path/model/apiKey or try another model.`;
        momWarn("runner", "final_empty_response_after_retries", {
          runId,
          chatId: this.chatId,
          totalAttempts: attemptCount,
          modelProvider: selectedModel.provider,
          modelId: selectedModel.id,
          modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
        });
        await ctx.replaceMessage(emptyResponseMessage);
        await ctx.respondInThread(
          `Empty assistant output detected after ${attemptCount} attempt(s). ` +
          `Model info — ${modelInfo}`,
        );
      }

      await ctx.setWorking(false);

      if (errorMessage) {
        momWarn("runner", "final_error", {
          runId,
          chatId: this.chatId,
          errorMessage,
        });
        await ctx.replaceMessage("Sorry, something went wrong.");
        await ctx.respondInThread(`Error: ${errorMessage}`);
      }

      momLog("runner", "run_end", {
        runId,
        chatId: this.chatId,
        stopReason,
        hasError: Boolean(errorMessage),
      });
      return { stopReason, errorMessage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      momError("runner", "run_exception", {
        runId,
        chatId: this.chatId,
        error: message,
      });
      try {
        await ctx.setWorking(false);
        await ctx.replaceMessage(`Run failed: ${message}`);
        await ctx.respondInThread(`Error: ${message}`);
      } catch {
        // ignore secondary UI errors
      }
      return { stopReason: "error", errorMessage: message };
    } finally {
      unsubscribe();
      this.running = false;
    }
  }
}

export class RunnerPool {
  private readonly map = new Map<string, MomRunner>();

  constructor(
    private readonly channel: string,
    private readonly store: MomRuntimeStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    private readonly usageTracker: AiUsageTracker,
    private readonly memory: MemoryGateway,
  ) { }

  private key(chatId: string, sessionId: string): string {
    return `${chatId}::${sessionId}`;
  }

  get(chatId: string, sessionId: string): MomRunner {
    const key = this.key(chatId, sessionId);
    const existing = this.map.get(key);
    if (existing) return existing;
    const runner = new MomRunner(
      this.channel,
      chatId,
      sessionId,
      this.store,
      this.getSettings,
      this.updateSettings,
      this.usageTracker,
      this.memory,
    );
    this.map.set(key, runner);
    return runner;
  }

  reset(chatId: string, sessionId: string): void {
    this.map.delete(this.key(chatId, sessionId));
  }
}

export function readBotUsernameFromMemory(workspaceDir: string): string | null {
  const path = join(workspaceDir, "BOT_USERNAME.txt");
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}
