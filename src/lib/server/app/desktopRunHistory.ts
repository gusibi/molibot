import type { RunHistoryItem } from "$lib/server/agent/session/reviewData";
import type {
  DesktopRunHistoryItem,
  DesktopRunOutcome
} from "$lib/shared/desktop";

const KNOWN_OUTCOMES: readonly DesktopRunOutcome[] = ["success", "partial", "failed"];

/**
 * Maps a server run-history item into a credential-safe Desktop view. Absolute
 * workspace/file/draft paths and the full `finalText` model output are dropped
 * — the Desktop run-history list only needs outcome, timing, tools, and the
 * reflection summary, never on-disk locations or raw transcript content.
 */
export function buildDesktopRunHistoryItem(item: RunHistoryItem): DesktopRunHistoryItem {
  const outcome: DesktopRunOutcome = (KNOWN_OUTCOMES as readonly string[]).includes(item.reflectionOutcome)
    ? (item.reflectionOutcome as DesktopRunOutcome)
    : "failed";
  return {
    runId: item.runId,
    createdAt: item.createdAt,
    botId: item.botId,
    chatId: item.chatId,
    stopReason: item.stopReason,
    durationMs: item.durationMs,
    toolNames: [...item.toolNames],
    failedToolNames: [...item.failedToolNames],
    reflectionOutcome: outcome,
    reflectionSummary: item.reflectionSummary,
    nextAction: item.nextAction,
    memorySelectedCount: item.memorySelectedCount,
    usedFallbackModel: item.usedFallbackModel
  };
}

export function buildDesktopRunHistoryCounts(items: DesktopRunHistoryItem[]): {
  total: number;
  success: number;
  partial: number;
  failed: number;
} {
  const counts = { total: items.length, success: 0, partial: 0, failed: 0 };
  for (const item of items) {
    if (item.reflectionOutcome === "success") counts.success += 1;
    else if (item.reflectionOutcome === "partial") counts.partial += 1;
    else counts.failed += 1;
  }
  return counts;
}
