import {
  PersistentTaskQueue,
  type PersistentTaskListItem,
  type PersistentTaskPreviewResult,
  type PersistentTaskQueueOptions
} from "./persistentTaskQueue.js";
import type { SharedRuntimeCommandOptions, SharedRuntimeCommandContext } from "../../agent/channelCommands.js";

interface InboundTaskCoordinatorOptions<TPayload, TTarget>
  extends Omit<PersistentTaskQueueOptions<TPayload>, "process"> {
  process: PersistentTaskQueueOptions<TPayload>["process"];
  enqueueFrontFromCommand?: (input: SharedRuntimeCommandContext<TTarget>, text: string) => Promise<number | null>;
}

export class InboundTaskCoordinator<TPayload, TTarget> {
  private readonly queue: PersistentTaskQueue<TPayload>;
  private readonly enqueueFrontFromCommandFn?: InboundTaskCoordinatorOptions<TPayload, TTarget>["enqueueFrontFromCommand"];

  constructor(options: InboundTaskCoordinatorOptions<TPayload, TTarget>) {
    this.queue = new PersistentTaskQueue<TPayload>({
      channel: options.channel,
      instanceId: options.instanceId,
      dbFile: options.dbFile,
      process: options.process
    });
    this.enqueueFrontFromCommandFn = options.enqueueFrontFromCommand;
  }

  enqueue(scopeId: string, payload: TPayload, options?: { front?: boolean; preview?: string }): number {
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

  cancelPending(scopeId: string): number {
    return this.queue.cancelPending(scopeId);
  }

  close(): void {
    this.queue.close();
  }

  toCommandOptions(): Pick<
    SharedRuntimeCommandOptions<TTarget>,
    "getQueueSize" | "listQueue" | "deleteQueued" | "getQueuedPreview" | "enqueueFront" | "cancelQueuedPending"
  > {
    return {
      getQueueSize: (scopeId) => this.size(scopeId),
      listQueue: async (scopeId) => this.list(scopeId),
      deleteQueued: async (scopeId, id) => this.delete(scopeId, id),
      getQueuedPreview: async (scopeId, id) => this.peek(scopeId, id),
      cancelQueuedPending: async (scopeId) => this.cancelPending(scopeId),
      enqueueFront: this.enqueueFrontFromCommandFn
        ? async (input, text) => this.enqueueFrontFromCommandFn?.(input, text) ?? null
        : undefined
    };
  }
}
