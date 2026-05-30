import type { MomContext } from "$lib/server/agent/core/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import {
  type ResolvedModelSelection,
  buildModelFallbackSelections
} from "$lib/server/agent/routing/modelRouting.js";
import {
  decideAudioRouting,
  enrichMessageTextWithAudio,
  decideVisionRouting,
  decideImageFallbackRouting,
  enrichMessageTextWithImages,
  type AudioRouteDecision,
  type VisionRouteDecision
} from "$lib/server/agent/routing/mediaFallback.js";
import { currentModelKey } from "$lib/server/settings/modelSwitch.js";
import { momLog } from "$lib/server/agent/common/log.js";

export interface EnrichedRunnerInput {
  enrichedText: string;
  activeSelection: ResolvedModelSelection;
  modelCandidates: ResolvedModelSelection[];
  modelUseCase: "text" | "vision";
  audioDecision: AudioRouteDecision;
  visionDecision: VisionRouteDecision;
}

export async function prepareEnrichedInput(options: {
  ctx: MomContext;
  settings: RuntimeSettings;
  respondInThread: (text: string) => Promise<void>;
  runId: string;
  chatId: string;
  sessionId: string;
}): Promise<EnrichedRunnerInput> {
  const { ctx, settings, respondInThread, runId, chatId, sessionId } = options;

  const audioDecision = decideAudioRouting(
    settings,
    ctx.message.attachments.some((item) => item.isAudio)
  );
  momLog("runner", "audio_route_decision", {
    runId,
    chatId,
    sessionId,
    mode: audioDecision.mode,
    reason: audioDecision.reason,
    audioRouteKey: currentModelKey(settings, "stt"),
    hasAudioInput: ctx.message.attachments.some((item) => item.isAudio)
  });

  const audioEnrichedInput = await enrichMessageTextWithAudio(ctx, settings, audioDecision);
  momLog("runner", "voice_transcription_success", {
    runId,
    chatId,
    sessionId,
    transcriptionErrors: audioEnrichedInput.transcriptionErrors.length,
    hasTranscripts: audioEnrichedInput.text !== ctx.message.text
  });
  if (audioEnrichedInput.transcriptionErrors.length > 0) {
    await respondInThread(
      [
        "语音识别失败，已降级为未转写消息。",
        ...audioEnrichedInput.transcriptionErrors,
        "建议：检查 STT provider 的 baseUrl/path/model 是否正确。"
      ].join("\n")
    );
  }

  const visionDecision = decideVisionRouting(
    settings,
    Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0
  );
  const imageDecision = decideImageFallbackRouting(
    settings,
    Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0,
    visionDecision
  );
  momLog("runner", "image_fallback_decision", {
    runId,
    chatId,
    sessionId,
    mode: imageDecision.mode,
    reason: imageDecision.reason,
    visionRouteKey: currentModelKey(settings, "vision"),
    hasImages: Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0
  });
  const enrichedInput = await enrichMessageTextWithImages(
    ctx,
    settings,
    imageDecision,
    audioEnrichedInput.text
  );
  momLog("runner", "image_analysis_success", {
    runId,
    chatId,
    sessionId,
    analysisErrors: enrichedInput.analysisErrors.length,
    hasAnalyses: enrichedInput.text !== audioEnrichedInput.text
  });
  if (enrichedInput.analysisErrors.length > 0) {
    await respondInThread(
      [
        "图片识别不可用，已降级为仅保留图片附件占位信息。",
        ...enrichedInput.analysisErrors,
        "建议：检查 vision provider 的 baseUrl/path/model，以及模型是否声明 `vision` 能力。"
      ].join("\n")
    );
  }

  const modelUseCase: "text" | "vision" = visionDecision.sendImagesNatively ? "vision" : "text";
  const modelCandidates = buildModelFallbackSelections(settings, visionDecision.selection, modelUseCase);
  const activeSelection = modelCandidates[0] ?? visionDecision.selection;

  return {
    enrichedText: enrichedInput.text,
    activeSelection,
    modelCandidates,
    modelUseCase,
    audioDecision,
    visionDecision
  };
}
