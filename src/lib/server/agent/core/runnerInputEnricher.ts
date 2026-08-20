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
  imageAttachmentCount: number;
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
  momLog("runner", "image_route_decision", {
    runId,
    chatId,
    sessionId,
    mode: visionDecision.mode,
    reason: visionDecision.reason,
    textRouteKey: currentModelKey(settings, "text"),
    hasImages: Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0
  });
  const modelUseCase: "text" | "vision" = "text";
  const modelCandidates = buildModelFallbackSelections(settings, visionDecision.selection, modelUseCase);
  const activeSelection = modelCandidates[0] ?? visionDecision.selection;

  const imageAttachmentCount = ctx.message.attachments.filter((item) => item.isImage).length;

  return {
    enrichedText: audioEnrichedInput.text,
    activeSelection,
    modelCandidates,
    modelUseCase,
    audioDecision,
    visionDecision,
    imageAttachmentCount
  };
}
