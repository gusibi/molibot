import { formatMemoryReflectionSummary } from "$lib/shared/memoryReflection.js";

export interface OwnerMemoryReflectionResult {
  completedTargets: number;
  scannedConversations: number;
  scannedMessages: number;
  createdCandidates: number;
  pendingReviewCandidateIds: string[];
  localDate: string;
  failedTargets: number;
  failedSessions?: number;
  committedMemories?: number;
}

export function formatOwnerMemoryReflectionNotification(
  result: OwnerMemoryReflectionResult,
  review: { pendingReviewCount: number; skillDraftCount: number }
): string {
  const prefix = result.failedTargets > 0
    ? result.failedSessions !== undefined
      ? `每日记忆反思执行失败：${result.failedSessions} 个会话提取失败或等待重试；`
      : `每日记忆反思执行失败：${result.completedTargets} 个 Bot 已完成，${result.failedTargets} 个 Bot 失败；`
    : `每日记忆反思已执行：${result.completedTargets} 个 Bot，`;
  const suffix = result.failedTargets > 0 ? "请查看自动任务历史。" : "";
  return `${prefix}${formatMemoryReflectionSummary({ ...result, ...review })}${suffix}`;
}
