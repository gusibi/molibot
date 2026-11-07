import { storagePaths } from "$lib/server/infra/db/storage.js";

/**
 * Process-local registry of the steer closures for running kanban rounds
 * (spec 执行形态修订 切片②: 用户插话通过 steer 立即注入当前执行轮次). The durable
 * runtime registers when a round dispatches and unregisters when it settles;
 * steering a task with no live round returns false and the caller falls back
 * to the pending-input channel.
 */
const steers = new Map<string, (text: string) => boolean>();

function key(executionId: string): string {
  return JSON.stringify([storagePaths.dataDir, executionId]);
}

export function registerKanbanSteer(executionId: string, steer: (text: string) => boolean): void {
  steers.set(key(executionId), steer);
}

export function unregisterKanbanSteer(executionId: string): void {
  steers.delete(key(executionId));
}

/** Injects text into the running round; false when the task has no live attempt. */
export function steerKanbanRound(executionId: string, text: string): boolean {
  const steer = steers.get(key(executionId));
  if (!steer) return false;
  try {
    return steer(text);
  } catch {
    return false;
  }
}
