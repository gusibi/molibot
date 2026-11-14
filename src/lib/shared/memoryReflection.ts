/** Counts describe one completed sweep, including its pending review snapshot. */
export interface MemoryReflectionSummary {
  totalConversations?: number;
  scannedConversations: number;
  idleExtractedConversations?: number;
  fallbackExtractedConversations?: number;
  scannedMessages: number;
  idleScannedMessages?: number;
  fallbackScannedMessages?: number;
  createdCandidates: number;
  committedMemories?: number;
  idleCommittedMemories?: number;
  fallbackCommittedMemories?: number;
  pendingReviewCount?: number;
  skillDraftCount?: number;
}

export function formatMemoryReflectionSummary(result: MemoryReflectionSummary, zh = true): string {
  const hasConversationBreakdown =
    result.totalConversations !== undefined || result.idleExtractedConversations !== undefined;
  const totalConv = result.totalConversations ?? result.scannedConversations;
  const idleConv = result.idleExtractedConversations ?? 0;
  const conversationPart = hasConversationBreakdown
    ? (zh
      ? `总会话 ${totalConv} 段，今日整理 ${result.scannedConversations} 段（白天抽取 ${idleConv} 段）、扫描 ${result.scannedMessages} 条消息`
      : `${totalConv} total conversations, organized ${result.scannedConversations} today (${idleConv} extracted during the day) and scanned ${result.scannedMessages} messages`)
    : (zh
      ? `整理 ${result.scannedConversations} 段对话、扫描 ${result.scannedMessages} 条消息`
      : `Reviewed ${result.scannedConversations} conversations and ${result.scannedMessages} messages`);
  const parts = [
    conversationPart,
    zh ? `本次新增 ${result.createdCandidates} 条候选` : `${result.createdCandidates} candidates created this run`
  ];
  if (result.committedMemories !== undefined) {
    const hasMemoryBreakdown =
      result.idleCommittedMemories !== undefined || result.fallbackCommittedMemories !== undefined;
    const idleMem = result.idleCommittedMemories ?? 0;
    const fallbackMem = result.fallbackCommittedMemories ?? 0;
    parts.push(
      hasMemoryBreakdown
        ? (zh
          ? `保存 ${result.committedMemories} 条记忆（白天抽取 ${idleMem} 条，本次兜底抽取 ${fallbackMem} 条）`
          : `${result.committedMemories} memories saved (${idleMem} extracted during the day, ${fallbackMem} in fallback)`)
        : (zh ? `保存 ${result.committedMemories} 条记忆` : `${result.committedMemories} memories saved`)
    );
  }
  parts.push(result.pendingReviewCount === undefined
    ? (zh ? '本次未记录待确认数量，请在记忆中心查看' : 'Review count was not recorded; check the memory center')
    : (zh ? `截至本次整理，待确认记忆 ${result.pendingReviewCount} 条` : `${result.pendingReviewCount} memories pending review at the end of this run`));
  if (result.skillDraftCount) parts.push(zh ? `技能草稿 ${result.skillDraftCount} 条，请在 APP 审核` : `${result.skillDraftCount} skill drafts to review in the app`);
  return parts.join(zh ? '；' : '; ') + (zh ? '。' : '.');
}
