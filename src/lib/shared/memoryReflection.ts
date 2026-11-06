/** Counts describe one completed sweep, including its pending review snapshot. */
export interface MemoryReflectionSummary {
  scannedConversations: number;
  scannedMessages: number;
  createdCandidates: number;
  committedMemories?: number;
  pendingReviewCount?: number;
  skillDraftCount?: number;
}

export function formatMemoryReflectionSummary(result: MemoryReflectionSummary, zh = true): string {
  const parts = zh
    ? [`整理 ${result.scannedConversations} 段对话、扫描 ${result.scannedMessages} 条消息`, `本次新增 ${result.createdCandidates} 条候选`]
    : [`Reviewed ${result.scannedConversations} conversations and ${result.scannedMessages} messages`, `${result.createdCandidates} candidates created this run`];
  if (result.committedMemories !== undefined) parts.push(zh ? `保存 ${result.committedMemories} 条记忆` : `${result.committedMemories} memories saved`);
  parts.push(result.pendingReviewCount === undefined
    ? (zh ? '本次未记录待确认数量，请在记忆中心查看' : 'Review count was not recorded; check the memory center')
    : (zh ? `截至本次整理，待确认记忆 ${result.pendingReviewCount} 条` : `${result.pendingReviewCount} memories pending review at the end of this run`));
  if (result.skillDraftCount) parts.push(zh ? `技能草稿 ${result.skillDraftCount} 条，请在 APP 审核` : `${result.skillDraftCount} skill drafts to review in the app`);
  return parts.join(zh ? '；' : '; ') + (zh ? '。' : '.');
}
