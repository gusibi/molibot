import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@mariozechner/pi-ai";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import {
  resolveModelSelection,
  sameModelSelection,
  type ResolvedModelSelection
} from "$lib/server/agent/routing/modelRouting.js";
import {
  resolveVisionFallbackTarget,
  describeImageViaConfiguredProvider
} from "$lib/server/agent/routing/vision-fallback.js";
import {
  resolveSttTarget,
  transcribeAudioViaConfiguredProvider
} from "$lib/server/agent/routing/stt.js";
import { momWarn } from "$lib/server/agent/common/log.js";
import type { MomContext } from "$lib/server/agent/core/types.js";

export function supportsVisionNatively(
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

export function supportsAudioInputConfigured(
  selection: ResolvedModelSelection
): boolean {
  if (selection.source !== "custom") return false;
  return Boolean(
    selection.configuredModel?.tags?.includes("audio_input") &&
    selection.configuredModel?.verification?.audio_input === "passed"
  );
}

export function decideVisionRouting(settings: RuntimeSettings, hasImages: boolean): {
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

  const visionSelection = resolveModelSelection(settings, "vision");
  if (!sameModelSelection(visionSelection, textSelection) && supportsVisionNatively(visionSelection)) {
    const verification = visionSelection.configuredModel?.verification?.vision ?? "missing";
    return {
      selection: visionSelection,
      sendImagesNatively: true,
      mode: "vision",
      reason: verification === "passed"
        ? "vision_route_declared_verified"
        : "vision_route_declared_unverified"
    };
  }

  if (supportsVisionNatively(textSelection)) {
    const verification = textSelection.configuredModel?.verification?.vision ?? "missing";
    return {
      selection: textSelection,
      sendImagesNatively: true,
      mode: "text",
      reason: verification === "passed"
        ? "text_model_declared_vision_verified"
        : "text_model_declared_vision_unverified"
    };
  }

  if (supportsVisionNatively(visionSelection)) {
    const verification = visionSelection.configuredModel?.verification?.vision ?? "missing";
    return {
      selection: visionSelection,
      sendImagesNatively: true,
      mode: "vision",
      reason: verification === "passed"
        ? "vision_route_declared_verified"
        : "vision_route_declared_unverified"
    };
  }

  return {
    selection: textSelection,
    sendImagesNatively: false,
    mode: "fallback",
    reason: "no_declared_native_vision"
  };
}

export function decideAudioRouting(settings: RuntimeSettings, hasAudio: boolean): {
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

export function decideImageFallbackRouting(
  settings: RuntimeSettings,
  hasImages: boolean,
  visionDecision: { sendImagesNatively: boolean; reason: string }
): {
  shouldAnalyze: boolean;
  mode: "none" | "native" | "vision" | "fallback";
  reason: string;
  userNotice?: string;
} {
  if (!hasImages) {
    return {
      shouldAnalyze: false,
      mode: "none",
      reason: "no_images"
    };
  }

  if (visionDecision.sendImagesNatively) {
    return {
      shouldAnalyze: false,
      mode: "native",
      reason: visionDecision.reason
    };
  }

  const target = resolveVisionFallbackTarget(settings);
  if (!target) {
    return {
      shouldAnalyze: false,
      mode: "fallback",
      reason: "no_vision_target",
      userNotice: "收到图片消息，但当前没有可用的 vision fallback 路由；系统将保留图片附件占位信息而不做内容识别。"
    };
  }

  if (!target.declared) {
    return {
      shouldAnalyze: false,
      mode: "fallback",
      reason: "vision_target_not_declared",
      userNotice: "收到图片消息，但当前选中的图片模型没有声明 `vision` 能力；系统将保留图片附件占位信息而不做内容识别。"
    };
  }

  if (target.verification === "failed") {
    return {
      shouldAnalyze: false,
      mode: "fallback",
      reason: "vision_target_failed_verification",
      userNotice: "收到图片消息，但当前可用的 vision 模型验证失败；系统将保留图片附件占位信息而不做内容识别。"
    };
  }

  return {
    shouldAnalyze: true,
    mode: "vision",
    reason: target.verification === "passed"
      ? "vision_fallback_verified"
      : "vision_fallback_declared_unverified"
  };
}

export function normalizeAudioMimeType(mimeType?: string | null): string {
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

export function resolveAudioExt(mimeType?: string | null): string {
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

export function ensureAudioFilename(filename: string, mimeType?: string | null): string {
  const trimmed = filename.trim() || "audio-message";
  const lower = trimmed.toLowerCase();
  if (/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|opus|wav|webm|aac)$/.test(lower)) {
    return trimmed;
  }
  return `${trimmed}${resolveAudioExt(mimeType)}`;
}

export async function enrichMessageTextWithAudio(
  ctx: MomContext,
  settings: RuntimeSettings,
  audioDecision: { shouldTranscribe: boolean; reason: string; userNotice?: string },
  baseText: string = ctx.message.text
): Promise<{
  text: string;
  transcriptionErrors: string[];
}> {
  const audioAttachments = ctx.message.attachments.filter((item) => item.isAudio);
  if (audioAttachments.length === 0) {
    return { text: baseText, transcriptionErrors: [] };
  }

  if (ctx.message.hasInlineAudioTranscript) {
    return { text: baseText, transcriptionErrors: [] };
  }

  if (!audioDecision.shouldTranscribe) {
    return {
      text: baseText,
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

  let text = baseText;
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

export async function enrichMessageTextWithImages(
  ctx: MomContext,
  settings: RuntimeSettings,
  imageDecision: { shouldAnalyze: boolean; reason: string; userNotice?: string },
  baseText: string
): Promise<{
  text: string;
  analysisErrors: string[];
}> {
  const imageAttachments = ctx.message.attachments.filter((item) => item.isImage);
  const imageContents = Array.isArray(ctx.message.imageContents) ? ctx.message.imageContents : [];
  if (imageAttachments.length === 0 || imageContents.length === 0) {
    return { text: baseText, analysisErrors: [] };
  }

  if (!imageDecision.shouldAnalyze) {
    return {
      text: baseText,
      analysisErrors: imageDecision.userNotice ? [imageDecision.userNotice] : []
    };
  }

  const analyses: string[] = [];
  const analysisErrors: string[] = [];
  const pairCount = Math.min(imageAttachments.length, imageContents.length);

  for (let index = 0; index < pairCount; index += 1) {
    const attachment = imageAttachments[index];
    const image = imageContents[index];
    const label = attachment?.original?.trim() || `image-${index + 1}`;
    const analysis = await describeImageViaConfiguredProvider({
      channel: ctx.channel,
      settings,
      image,
      label,
      maxAttempts: 3,
      retryDelayMs: 800
    });

    if (analysis.text) {
      analyses.push(`[image analysis #${index + 1}: ${label}]\n${analysis.text}`);
    } else if (analysis.errorMessage) {
      analysisErrors.push(`${label}: ${analysis.errorMessage}`);
    }
  }

  let text = baseText;
  if (analyses.length > 0) {
    const imageSection = analyses.join("\n\n");
    text = text.trim()
      ? `${text}\n\n${imageSection}`
      : imageSection;
  } else if (!text.trim()) {
    text = "(image message received; analysis unavailable)";
  }

  return { text, analysisErrors };
}

export function stripImagePartsForTextOnlyModel(selectedModel: Model<any>, context: any): any {
  const supportsImage = Array.isArray(selectedModel.input) && selectedModel.input.includes("image");
  if (supportsImage) return context;
  if (!context || typeof context !== "object" || !Array.isArray(context.messages)) return context;

  const messages = context.messages.map((message: any) => {
    if (!message || typeof message !== "object" || !Array.isArray(message.content)) return message;

    const filtered = message.content.filter((part: any) => part?.type !== "image");
    if (filtered.length > 0) {
      return { ...message, content: filtered };
    }

    const hadImage = message.content.some((part: any) => part?.type === "image");
    if (!hadImage) return message;

    return {
      ...message,
      content: [{ type: "text", text: "[image omitted from context for text-only model]" }]
    };
  });

  return {
    ...context,
    messages
  };
}
