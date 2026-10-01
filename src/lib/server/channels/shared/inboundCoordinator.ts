import {
  PersistentTaskQueue,
  type CancelPendingResult,
  type PersistentTaskListItem,
  type PersistentTaskPreviewResult,
  type PersistentTaskQueueOptions
} from "$lib/server/channels/shared/persistentTaskQueue.js";
import type { SharedRuntimeCommandOptions, SharedRuntimeCommandContext } from "$lib/server/agent/commands/channelCommands.js";

interface InboundTaskCoordinatorOptions<TPayload, TTarget>
  extends Omit<PersistentTaskQueueOptions<TPayload>, "process"> {
  process: PersistentTaskQueueOptions<TPayload>["process"];
  prepareAdmission?: (scopeId: string, payload: TPayload, retry: boolean) => void;
  enqueueFrontFromCommand?: (input: SharedRuntimeCommandContext<TTarget>, text: string) => Promise<number | null>;
}

export class InboundTaskCoordinator<TPayload, TTarget> {
  private readonly prepareAdmission?: InboundTaskCoordinatorOptions<TPayload, TTarget>["prepareAdmission"];
  private readonly queue: PersistentTaskQueue<TPayload>;
  private readonly enqueueFrontFromCommandFn?: InboundTaskCoordinatorOptions<TPayload, TTarget>["enqueueFrontFromCommand"];

  constructor(options: InboundTaskCoordinatorOptions<TPayload, TTarget>) {
    this.queue = new PersistentTaskQueue<TPayload>({
      channel: options.channel,
      instanceId: options.instanceId,
      dbFile: options.dbFile,
      process: options.process
    });
    this.prepareAdmission = options.prepareAdmission;
    this.enqueueFrontFromCommandFn = options.enqueueFrontFromCommand;
  }

  enqueue(scopeId: string, payload: TPayload, options?: { front?: boolean; preview?: string }): number {
    this.prepareAdmission?.(scopeId, payload, false);
    return this.queue.enqueue(scopeId, payload, options);
  }

  resumeAll(): Promise<void> {
    return this.queue.resumeAll();
  }

  size(scopeId: string): number {
    return this.queue.size(scopeId);
  }

  list(scopeId: string): PersistentTaskListItem[] {
    return this.queue.list(scopeId);
  }

  delete(scopeId: string, id: number): "deleted" | "running" | "not_found" {
    return this.queue.delete(scopeId, id);
  }

  peek(scopeId: string, id: number): PersistentTaskPreviewResult {
    return this.queue.peek(scopeId, id);
  }

  cancelPending(scopeId: string, expectedIds?: number[]): CancelPendingResult {
    return this.queue.cancelPending(scopeId, expectedIds);
  }

  retryRecovery(scopeId: string, id: number): "retried" | "running" | "not_found" {
    return this.queue.retryRecovery(scopeId, id, (payload) => this.prepareAdmission?.(scopeId, payload, true));
  }

  close(): void {
    this.queue.close();
  }

  toCommandOptions(): Pick<
    SharedRuntimeCommandOptions<TTarget>,
    "getQueueSize" | "listQueue" | "deleteQueued" | "retryQueued" | "getQueuedPreview" | "enqueueFront" | "cancelQueuedPending"
  > {
    return {
      getQueueSize: (scopeId) => this.size(scopeId),
      listQueue: async (scopeId) => this.list(scopeId),
      deleteQueued: async (scopeId, id) => this.delete(scopeId, id),
      retryQueued: async (scopeId, id) => this.retryRecovery(scopeId, id),
      getQueuedPreview: async (scopeId, id) => this.peek(scopeId, id),
      cancelQueuedPending: async (scopeId, expectedIds) => this.cancelPending(scopeId, expectedIds),
      enqueueFront: this.enqueueFrontFromCommandFn
        ? async (input, text) => this.enqueueFrontFromCommandFn?.(input, text) ?? null
        : undefined
    };
  }
}
