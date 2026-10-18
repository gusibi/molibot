import type { ChannelManager } from "$lib/server/channels/registry.js";
import { PiRecoveryStore, type PiRecoveryRecord } from '$lib/server/agent/core/piRecoveryStore.js';

import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { CompactionTask, GenerationTask, ToolTask, type Cursor } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { existsSync } from 'node:fs';

/**
 * What startup may do with one admitted execution after a restart.
 *
 * - `resume` continues from the native Safe Resume Point. Committed tool results
 *   are reused; only work the native ledger still owns is replayed.
 * - `review` blocks the same semantic operation: a remote request or an external
 *   operation was durably admitted without a committed result, so re-running it
 *   could duplicate a side effect or a charge.
 * - `unavailable` has no readable native execution to continue.
 */
export type PiRecoveryDisposition = "resume" | "review" | "unavailable";

export interface PiRecoveryInspection {
  record: PiRecoveryRecord;
  disposition: PiRecoveryDisposition;
  /** Human-readable reason attached to `review` and `unavailable`. */
  reason?: string;
  /** Tool call ids whose outcome is unknown, for a human recovery-review decision. */
  uncertainCallIds?: string[];
}

export const PI_RECOVERY_REVIEW_MODEL = "A model request was durably admitted without a committed result; its remote outcome is unknown and it is not resent automatically.";
export const PI_RECOVERY_REVIEW_TOOL = "An external operation was durably admitted without a committed result and is not safe to replay; rerunning it could duplicate a side effect.";
export const PI_RECOVERY_UNAVAILABLE = "The original execution record is missing or unreadable, so it cannot be continued.";

/** Admission identities are held during startup until native checkpoints have been inspected. */
export function piRecoveryCandidates(dataRoot: string, status: (runId: string) => string | undefined): PiRecoveryRecord[] {
  const store = new PiRecoveryStore(dataRoot);
  try {
    const candidates = store.all();
    // recovery_review runs are parked waiting for a human decision, so their
    // admitted identity must survive until that decision arrives.
    const preserved = new Set(['running', 'waiting_for_approval', 'recovery_review']);
    for (const record of candidates) if (!preserved.has(status(record.runId) ?? '')) store.remove(record.runId);
    return candidates.filter(record => ['running', 'recovery_review'].includes(status(record.runId) ?? ''));
  } finally { store.close(); }
}

/**
 * Classify one native execution through Pi's formal task records, never its private
 * JSON layout. A live model request (`generation.request` or `compaction.summarize`)
 * may already have reached the provider; a live tool parked in `execute` may
 * already have changed the world. Either blocks automatic resubmission. Every other
 * live state (prepare, retry, poll, select, tools, unstarted tool calls) resumes at
 * the native checkpoint.
 */
async function inspectNativeExecution(storagePath: string): Promise<Pick<PiRecoveryInspection, "disposition" | "reason" | "uncertainCallIds">> {
  const storage = await openNodeSqliteStorage(storagePath);
  const uncertainCallIds: string[] = [];
  try {
    for (const kind of [GenerationTask.definition.name, CompactionTask.definition.name, ToolTask.definition.name]) {
      let cursor: Cursor | undefined;
      do {
        const page = await storage.scanTasks({ kind }, 64, cursor, BACKGROUND_CONTEXT);
        for (const task of page.items) {
          if (task.state.status === "terminal") continue;
          const checkpoint = "checkpoint" in task.state ? task.state.checkpoint : undefined;
          if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) continue;
          const phase = (checkpoint as { phase?: unknown }).phase;
          if (kind === GenerationTask.definition.name && phase === "request") return { disposition: "review", reason: PI_RECOVERY_REVIEW_MODEL, uncertainCallIds };
          if (kind === CompactionTask.definition.name && phase === "summarize") return { disposition: "review", reason: PI_RECOVERY_REVIEW_MODEL, uncertainCallIds };
          if (kind === ToolTask.definition.name && phase === "execute" && (checkpoint as { replay?: unknown }).replay !== "safe") {
            const input = task.input as { callId?: unknown } | undefined;
            if (input && typeof input.callId === "string") uncertainCallIds.push(input.callId);
          }
        }
        cursor = page.next;
      } while (cursor !== undefined);
    }
    if (uncertainCallIds.length) return { disposition: "review", reason: PI_RECOVERY_REVIEW_TOOL, uncertainCallIds };
    return { disposition: "resume" };
  } finally { await storage.close(BACKGROUND_CONTEXT); }
}

/** Inspect every running owner once and classify what startup may do with it. */
export async function inspectPiRecovery(dataRoot: string, status: (runId: string) => string | undefined): Promise<PiRecoveryInspection[]> {
  const inspected: PiRecoveryInspection[] = [];
  for (const record of piRecoveryCandidates(dataRoot, status)) {
    if (!record.storagePath || !existsSync(record.storagePath)) {
      inspected.push({ record, disposition: "unavailable", reason: PI_RECOVERY_UNAVAILABLE });
      continue;
    }
    try {
      inspected.push({ record, ...await inspectNativeExecution(record.storagePath) });
    } catch {
      // A damaged checkpoint cannot authorize resubmission; report it instead of guessing.
      inspected.push({ record, disposition: "unavailable", reason: PI_RECOVERY_UNAVAILABLE });
    }
  }
  return inspected.filter(({ record }) => status(record.runId) === "running");
}

/** Owners startup may continue from their native Safe Resume Point. */
export async function pendingPiRecovery(dataRoot: string, status: (runId: string) => string | undefined): Promise<PiRecoveryRecord[]> {
  return (await inspectPiRecovery(dataRoot, status)).filter(({ disposition }) => disposition === "resume").map(({ record }) => record);
}

import { MomRuntimeStore } from '$lib/server/agent/session/store.js';
import { runBackgroundConversation } from './backgroundConversation.js';
import type { RunnerLike } from '$lib/server/agent/core/types.js';
import type { SessionStore } from '$lib/server/sessions/store.js';

export async function resumePiOwner(owner: PiRecoveryRecord, runner: Pick<RunnerLike, 'run'>, sessions: Pick<SessionStore, 'appendMessage' | 'listMessageMetadata'>, notify?: (text: string) => Promise<void>) {
  const store = new MomRuntimeStore(owner.workspaceDir, { source: { channel: owner.transport?.channel ?? owner.channel, botId: owner.transport?.instanceId ?? "default" } });
  const { executionPolicy: _policy, ...context } = owner.context;
  const outcome = await runBackgroundConversation(runner, {
    ...context, channel: owner.transport?.channel ?? owner.channel, deliveryTarget: owner.transport, workspaceDir: owner.workspaceDir, chatDir: store.getChatDir(owner.chatId),
    message: { chatId: owner.chatId, sessionId: owner.sessionId, runId: owner.runId, workspaceId: owner.workspaceId,
      budgetId: owner.budgetId, userId: owner.actor, userName: owner.actor, text: '', isEvent: true,
      messageId: Date.now(), ts: String(Date.now() / 1000), attachments: [], imageContents: [], chatType: 'private' }
  }, sessions);
  // A resumed run that already recorded its answer must not notify again either.
  if (outcome.recorded && outcome.answer.trim() && outcome.stopReason !== "waiting_for_approval") await notify?.(outcome.answer);
  return outcome;
}


export function piRecoveryChannelManager(owner: PiRecoveryRecord, managers: Map<string, Map<string, ChannelManager>>): ChannelManager | undefined {
  const target = owner.transport;
  if (!target) return undefined;
  const manager = managers.get(target.channel)?.get(target.instanceId);
  return manager?.getWorkspaceDir?.() === target.workspaceDir ? manager : undefined;
}
