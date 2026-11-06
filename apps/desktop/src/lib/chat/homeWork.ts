import type { DesktopSystemTaskExecutionResult, DesktopTaskItem } from '@molibot/desktop-contract';
export type HomeReceipts = Record<string, string>;
export function readHomeReceipts(raw: string | null): HomeReceipts {
  try {
    const parsed = JSON.parse(raw ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string').slice(-512));
  } catch { return {}; }
}
/** Store execution identity, so reading one edition never hides the next edition. */
export function markHomeReceipt(receipts: HomeReceipts, taskId: string, executionId: string): HomeReceipts {
  return Object.fromEntries([...Object.entries(receipts).filter(([id]) => id !== taskId), [taskId, executionId]].slice(-512));
}
export function shouldShowHomeTask(task: DesktopTaskItem, receipts: HomeReceipts, result?: DesktopSystemTaskExecutionResult): boolean {
  const execution = task.executions[0];
  if (task.active || execution?.status === 'waiting_approval' || execution?.status === 'retry_wait') return true;
  if (!execution) return task.reminderUnread === true;
  if (task.maintenance && ['completed', 'skipped', 'aborted'].includes(execution.status)) return false;
  if (execution.status === 'completed' && result?.kind === 'memory-reflection'
    && result.createdCandidates === 0 && result.committedMemories === 0
    && result.pendingReviewCount === 0 && result.skillDraftCount === 0) return false;
  return receipts[task.taskId] !== execution.id;
}

/** A changing history window must not revive replies older than the read watermark. */
export function hasUnreadCrossChannel(summary: { latestAt: string } | undefined, seen: string | undefined): boolean {
  if (!summary) return false;
  const watermark = Date.parse(seen ?? '');
  return !Number.isFinite(watermark) || Date.parse(summary.latestAt) > watermark;
}
