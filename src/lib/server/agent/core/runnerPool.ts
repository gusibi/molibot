import { MomRunner } from "./runner.js";
import { type RuntimeSettings } from "$lib/server/settings/index.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { HookManager } from "$lib/server/agent/hooks/index.js";

/**
 * The pool surface channel runtimes and shared commands are allowed to use.
 * `ProjectAwareRunnerPool` implements the same surface but reroutes bound
 * scopes to the project runtime pool, so callers must depend on this
 * interface instead of the concrete `RunnerPool`.
 */
export interface ChannelRunnerPoolLike {
  get(chatId: string, sessionId: string): MomRunner;
  abort(chatId: string, sessionId: string): boolean;
  steer(chatId: string, sessionId: string, text: string): boolean;
  followUp(chatId: string, sessionId: string, text: string): boolean;
  reset(chatId: string, sessionId: string): void;
  snapshotRunning(): Array<{ chatId: string; sessionId: string }>;
  compact(
    chatId: string,
    sessionId: string,
    options?: { reason?: "threshold" | "manual"; customInstructions?: string }
  ): Promise<{
    changed: boolean;
    summary: string;
    beforeTokens: number;
    afterTokens: number;
    summarizedMessages: number;
    keptMessages: number;
  }>;
}

export class RunnerPool implements ChannelRunnerPoolLike {
  private readonly map = new Map<string, MomRunner>();

  constructor(
    private readonly channel: string,
    private readonly store: MomRuntimeStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    private readonly usageTracker: AiUsageTracker,
    private readonly modelErrorTracker: ModelErrorTracker,
    private readonly memory: MemoryGateway,
    private readonly hookManager: HookManager,
  ) { }

  private key(chatId: string, sessionId: string): string {
    return `${chatId}::${sessionId}`;
  }

  get(chatId: string, sessionId: string): MomRunner {
    const key = this.key(chatId, sessionId);
    const existing = this.map.get(key);
    if (existing) return existing;
    const runner = new MomRunner(
      this.channel,
      chatId,
      sessionId,
      this.store,
      this.getSettings,
      this.updateSettings,
      this.usageTracker,
      this.modelErrorTracker,
      this.memory,
      this.hookManager,
    );
    this.map.set(key, runner);
    return runner;
  }

  abort(chatId: string, sessionId: string): boolean {
    const runner = this.get(chatId, sessionId);
    if (!runner.isRunning()) return false;
    runner.abort();
    return true;
  }

  snapshotRunning(): Array<{ chatId: string; sessionId: string }> {
    return [...this.map.values()].flatMap((runner) => {
      const snapshot = runner.snapshotActiveRun();
      return snapshot ? [snapshot] : [];
    });
  }

  steer(chatId: string, sessionId: string, text: string): boolean {
    return this.get(chatId, sessionId).steer(text);
  }

  followUp(chatId: string, sessionId: string, text: string): boolean {
    return this.get(chatId, sessionId).followUp(text);
  }

  reset(chatId: string, sessionId: string): void {
    this.map.delete(this.key(chatId, sessionId));
  }

  async compact(
    chatId: string,
    sessionId: string,
    options?: {
      reason?: "threshold" | "manual";
      customInstructions?: string;
    }
  ): Promise<{
    changed: boolean;
    summary: string;
    beforeTokens: number;
    afterTokens: number;
    summarizedMessages: number;
    keptMessages: number;
  }> {
    return this.get(chatId, sessionId).compact(options);
  }
}
