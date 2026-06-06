import { MomRunner } from "./runner.js";
import { type RuntimeSettings } from "$lib/server/settings/index.js";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import type { AiUsageTracker } from "$lib/server/usage/tracker.js";
import type { ModelErrorTracker } from "$lib/server/usage/modelErrorTracker.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { HookManager } from "$lib/server/agent/hooks/index.js";

export class RunnerPool {
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
