import type { MomRunner } from "$lib/server/agent/core/runner.js";
import { RunnerPool, type ChannelRunnerPoolLike } from "$lib/server/agent/core/runnerPool.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import type { HookManager } from "$lib/server/agent/hooks/index.js";
import { getProjectStore, type ProjectRecord } from "$lib/server/projects/store.js";
import {
  getOrCreateProjectRuntimeHandle,
  projectRuntimeWorkspaceDir
} from "$lib/server/projects/runtimeCache.js";
import type { Channel } from "$lib/shared/types/message.js";

export interface ResolvedRunnerTarget {
  pool: RunnerPool;
  store: MomRuntimeStore;
  /** Pool key: the bot-local scope id, or the conversation key in Project mode. */
  chatId: string;
  /** Pool key: the channel session id, or the project conversation uuid in Project mode. */
  sessionId: string;
  project: ProjectRecord | null;
  conversationKey: string;
  /** Project conversation uuid; null outside Project mode. */
  conversationId: string | null;
}

/**
 * Routes a channel scope's runner to the project runtime when the scope has an
 * active Project binding, so a chat in Project mode shares the exact agent
 * context (`<dataRoot>/projects/<id>/runtime/<conversationKey>/contexts/<conversationId>.json`)
 * with the Desktop app. Unbound scopes keep using the bot-local pool.
 *
 * Automation task sessions (`task-*`) always stay on the bot pool so scheduled
 * runs never leak into the project session list.
 */
export class ProjectAwareRunnerPool implements ChannelRunnerPoolLike {
  private readonly touchedProjectPools = new Map<string, RunnerPool>();

  constructor(
    private readonly base: RunnerPool,
    private readonly options: {
      channel: string;
      instanceId: string;
      sessions: SessionStore;
      botStore: MomRuntimeStore;
      getSettings: () => RuntimeSettings;
      updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
      usageTracker: AiUsageTracker;
      modelErrorTracker: ModelErrorTracker;
      memory: MemoryGateway;
      hookManager: HookManager;
    }
  ) {}

  /**
   * Same runtime handle the Desktop/Web router resolves (shared process-wide
   * cache), so both surfaces drive one MomRunner per project conversation.
   * Pools are labelled "web" to match the ones web/runtimeContext creates —
   * the per-run channel still comes from ctx.channel.
   */
  private getProjectRuntime(projectId: string): { store: MomRuntimeStore; pool: RunnerPool } {
    return getOrCreateProjectRuntimeHandle(projectId, () => {
      const store = new MomRuntimeStore(projectRuntimeWorkspaceDir(projectId));
      const pool = new RunnerPool(
        "web",
        store,
        this.options.getSettings,
        this.options.updateSettings,
        this.options.usageTracker,
        this.options.modelErrorTracker,
        this.options.memory,
        this.options.hookManager
      );
      return { store, pool };
    });
  }

  resolveTarget(scopeId: string, sessionId: string): ResolvedRunnerTarget {
    const conversationKey = `bot:${this.options.instanceId}:chat:${scopeId}:${sessionId}`;
    const botTarget: ResolvedRunnerTarget = {
      pool: this.base,
      store: this.options.botStore,
      chatId: scopeId,
      sessionId,
      project: null,
      conversationKey,
      conversationId: null
    };
    if (sessionId.startsWith("task-")) return botTarget;

    let project: ProjectRecord | null = null;
    try {
      project = getProjectStore().getChannelBinding(this.options.channel, this.options.instanceId, scopeId);
    } catch {
      return botTarget;
    }
    if (!project) return botTarget;

    const conversation = this.options.sessions.getOrCreateConversation(
      this.options.channel as Channel,
      conversationKey,
      undefined,
      { projectId: project.id }
    );
    const { store, pool } = this.getProjectRuntime(project.id);
    this.touchedProjectPools.set(project.id, pool);
    return {
      pool,
      store,
      chatId: conversationKey,
      sessionId: conversation.id,
      project,
      conversationKey,
      conversationId: conversation.id
    };
  }

  get(chatId: string, sessionId: string): MomRunner {
    const target = this.resolveTarget(chatId, sessionId);
    return target.pool.get(target.chatId, target.sessionId);
  }

  abort(chatId: string, sessionId: string): boolean {
    const target = this.resolveTarget(chatId, sessionId);
    let aborted = target.pool.abort(target.chatId, target.sessionId);
    // A run started before the binding changed may still live on the bot pool.
    if (target.project) {
      aborted = this.base.abort(chatId, sessionId) || aborted;
    }
    return aborted;
  }

  steer(chatId: string, sessionId: string, text: string): boolean {
    const target = this.resolveTarget(chatId, sessionId);
    return target.pool.steer(target.chatId, target.sessionId, text);
  }

  followUp(chatId: string, sessionId: string, text: string): boolean {
    const target = this.resolveTarget(chatId, sessionId);
    return target.pool.followUp(target.chatId, target.sessionId, text);
  }

  reset(chatId: string, sessionId: string): void {
    const target = this.resolveTarget(chatId, sessionId);
    target.pool.reset(target.chatId, target.sessionId);
    if (target.project) {
      this.base.reset(chatId, sessionId);
    }
  }

  snapshotRunning(): Array<{ chatId: string; sessionId: string }> {
    const snapshots = this.base.snapshotRunning();
    for (const pool of this.touchedProjectPools.values()) {
      snapshots.push(...pool.snapshotRunning());
    }
    return snapshots;
  }

  compact(
    chatId: string,
    sessionId: string,
    options?: { reason?: "threshold" | "manual"; customInstructions?: string }
  ): ReturnType<RunnerPool["compact"]> {
    const target = this.resolveTarget(chatId, sessionId);
    return target.pool.compact(target.chatId, target.sessionId, options);
  }
}
