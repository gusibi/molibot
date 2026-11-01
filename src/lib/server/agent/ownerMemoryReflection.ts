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
  const reviewText = review.skillDraftCount > 0
    ? `新增 ${result.createdCandidates} 条候选；本次有 ${review.pendingReviewCount} 条待确认记忆，${review.skillDraftCount} 条技能草稿需在 APP 审核。`
    : result.createdCandidates === review.pendingReviewCount
      ? `新增 ${review.pendingReviewCount} 条待确认记忆。`
      : `新增 ${result.createdCandidates} 条候选；本次有 ${review.pendingReviewCount} 条待确认记忆。`;
  const suffix = result.failedTargets > 0 ? "请查看自动任务历史。" : "";
  const saved = result.committedMemories ? `保存 ${result.committedMemories} 条记忆，` : "";
  return `${prefix}扫描 ${result.scannedMessages} 条消息，${saved}${reviewText}${suffix}`;
}
