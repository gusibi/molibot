import type { MomEvent } from "$lib/server/agent/events.js";

type ReflectionInternal = NonNullable<MomEvent["internal"]>;
type ReflectionResult = {
  localDate: string;
  scannedConversations?: number;
  scannedMessages: number;
  createdCandidates: number;
  pendingReviewCandidateIds: string[];
};

export interface OwnerMemoryReflectionResult {
  completedTargets: number;
  scannedConversations: number;
  scannedMessages: number;
  createdCandidates: number;
  pendingReviewCandidateIds: string[];
  localDate: string;
  failedTargets: number;
}

export class OwnerMemoryReflectionError extends AggregateError {
  constructor(errors: unknown[], readonly result: OwnerMemoryReflectionResult) {
    super(errors, `${errors.length} memory reflection target(s) failed.`);
    this.name = "OwnerMemoryReflectionError";
  }
}

export function formatOwnerMemoryReflectionNotification(
  result: OwnerMemoryReflectionResult,
  review: { pendingReviewCount: number; skillDraftCount: number }
): string {
  const prefix = result.failedTargets > 0
    ? `每日记忆反思执行失败：${result.completedTargets} 个 Bot 已完成，${result.failedTargets} 个 Bot 失败；`
    : `每日记忆反思已执行：${result.completedTargets} 个 Bot，`;
  const reviewText = review.skillDraftCount > 0
    ? `新增 ${result.createdCandidates} 条候选；本次有 ${review.pendingReviewCount} 条待确认记忆，${review.skillDraftCount} 条技能草稿需在 APP 审核。`
    : result.createdCandidates === review.pendingReviewCount
      ? `新增 ${review.pendingReviewCount} 条待确认记忆。`
      : `新增 ${result.createdCandidates} 条候选；本次有 ${review.pendingReviewCount} 条待确认记忆。`;
  const suffix = result.failedTargets > 0 ? "请查看自动任务历史。" : "";
  return `${prefix}扫描 ${result.scannedMessages} 条消息，${reviewText}${suffix}`;
}

export async function executeOwnerMemoryReflection(
  internals: ReflectionInternal[],
  run: (internal: ReflectionInternal) => Promise<ReflectionResult>
): Promise<OwnerMemoryReflectionResult> {
  let completedBots = 0;
  let scannedConversations = 0;
  let scannedMessages = 0;
  let createdCandidates = 0;
  let localDate = "";
  const pendingReviewCandidateIds = new Set<string>();
  const failures: unknown[] = [];

  for (const internal of internals) {
    try {
      const result = await run(internal);
      completedBots += 1;
      scannedConversations += result.scannedConversations ?? 0;
      scannedMessages += result.scannedMessages;
      createdCandidates += result.createdCandidates;
      localDate ||= result.localDate;
      for (const candidateId of result.pendingReviewCandidateIds) pendingReviewCandidateIds.add(candidateId);
    } catch (cause) {
      failures.push(cause);
    }
  }

  const result = {
    completedTargets: completedBots,
    scannedConversations,
    scannedMessages,
    createdCandidates,
    pendingReviewCandidateIds: [...pendingReviewCandidateIds],
    localDate,
    failedTargets: failures.length
  };
  if (failures.length > 0) throw new OwnerMemoryReflectionError(failures, result);
  return result;
}
