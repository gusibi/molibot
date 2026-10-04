import type { ChannelManager } from "$lib/server/channels/registry.js";
import { PiRecoveryStore, type PiRecoveryRecord } from '$lib/server/agent/core/piRecoveryStore.js';

import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { GenerationTask, type Cursor } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { existsSync } from 'node:fs';

/** Admission identities are held during startup until native checkpoints have been inspected. */
export function piRecoveryCandidates(dataRoot: string, status: (runId: string) => string | undefined): PiRecoveryRecord[] {
  const store = new PiRecoveryStore(dataRoot);
  try {
    const candidates = store.all();
    for (const record of candidates) if (status(record.runId) !== 'running' && status(record.runId) !== 'waiting_for_approval') store.remove(record.runId);
    return candidates.filter(record => status(record.runId) === 'running');
  } finally { store.close(); }
}

/** Native poll checkpoints are authoritative, including the gap before display events are projected. */
export async function pendingPiRecovery(dataRoot: string, status: (runId: string) => string | undefined): Promise<PiRecoveryRecord[]> {
  const result: PiRecoveryRecord[] = [];
  for (const record of piRecoveryCandidates(dataRoot, status)) {
    if (record.deferred) { result.push(record); continue; }
    if (!record.storagePath || !existsSync(record.storagePath)) continue;
    try {
      const storage = await openNodeSqliteStorage(record.storagePath);
      try {
      let cursor: Cursor | undefined;
      let pending = false;
      do {
        const page = await storage.scanTasks({ kind: GenerationTask.definition.name }, 64, cursor, BACKGROUND_CONTEXT);
        pending ||= page.items.some(task => 'checkpoint' in task.state && typeof task.state.checkpoint === 'object' && task.state.checkpoint !== null && !Array.isArray(task.state.checkpoint) && task.state.checkpoint.phase === 'poll');
        cursor = page.next;
      } while (!pending && cursor !== undefined);
      if (pending) result.push(record);
      } finally { await storage.close(BACKGROUND_CONTEXT); }
    } catch {
      // A damaged checkpoint cannot authorize resubmission; startup will fail this owner.
    }
  }
  return result.filter(record => status(record.runId) === 'running');
}

import { MomRuntimeStore } from '$lib/server/agent/session/store.js';
import { runBackgroundConversation } from './backgroundConversation.js';
import type { RunnerLike } from '$lib/server/agent/core/types.js';
import type { SessionStore } from '$lib/server/sessions/store.js';

export async function resumePiOwner(owner: PiRecoveryRecord, runner: Pick<RunnerLike, 'run'>, sessions: Pick<SessionStore, 'appendMessage'>, notify?: (text: string) => Promise<void>) {
  const store = new MomRuntimeStore(owner.workspaceDir);
  const { executionPolicy: _policy, ...context } = owner.context;
  let answer = "";
  const result = await runBackgroundConversation(runner, {
    ...context, channel: owner.transport?.channel ?? owner.channel, deliveryTarget: owner.transport, workspaceDir: owner.workspaceDir, chatDir: store.getChatDir(owner.chatId),
    message: { chatId: owner.chatId, sessionId: owner.sessionId, runId: owner.runId, workspaceId: owner.workspaceId,
      budgetId: owner.budgetId, userId: owner.actor, userName: owner.actor, text: '', isEvent: true,
      messageId: Date.now(), ts: String(Date.now() / 1000), attachments: [], imageContents: [], chatType: 'private' }
  }, { appendMessage: (...args) => { answer = args[2]; return sessions.appendMessage(...args); } });
  if (answer.trim() && result.stopReason !== "waiting_for_approval") await notify?.(answer);
  return result;
}


export function piRecoveryChannelManager(owner: PiRecoveryRecord, managers: Map<string, Map<string, ChannelManager>>): ChannelManager | undefined {
  const target = owner.transport;
  if (!target) return undefined;
  const manager = managers.get(target.channel)?.get(target.instanceId);
  return manager?.getWorkspaceDir?.() === target.workspaceDir ? manager : undefined;
}
