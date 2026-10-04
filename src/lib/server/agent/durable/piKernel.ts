import { withPiInvocation, type NativeInvocation } from "./piInvocation.js";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { awaitWithContext, BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, Models, ToolCall } from "@earendil-works/pi-ai";
import { createRegistry, defineEntry, defineExtension, defineTool, GenerationTask, CompactionTask, Harness, hook, ToolTask, watchEvents, type AgentEvent, type AgentEventStream, type EntryRecord, type ModelRef, type HookApi, type ToolExecutionApi, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { encodePiToolDetails } from "./piToolResult.js";
import { createPiPreparationEffects, PiPreparationRecoveryError } from "./piPreparationEffects.js";
import { hasToolPreparation, type HostToolResult, type PreparedAgentInvocation } from "$lib/server/agent/tools/preparedTool.js";

const ExecutionBinding = defineEntry<{ fingerprint: string; requestId: string; text: string; instructions: string }>("molibot.execution-binding");
const HistoryEntry = defineEntry("molibot.history");
const activeStoragePaths = new Set<string>();

export function claimPiStorage(path: string): () => void {
  const key = resolve(path);
  if (activeStoragePaths.has(key)) throw new Error("Pi execution storage is already active.");
  activeStoragePaths.add(key);
  let released = false;
  return () => { if (!released) { released = true; activeStoragePaths.delete(key); } };
}

export interface PiDurableKernelOptions {
  nested?: (invocation: Pick<NativeInvocation, "api" | "context">, tool: AgentTool, id: string, args: unknown) => ReturnType<NativeInvocation["nested"]>;
  extensionName?: string;
  child?: (invocation: Pick<NativeInvocation, "api" | "context">, options: Parameters<NativeInvocation["child"]>[0]) => ReturnType<NativeInvocation["child"]>;
  storagePath: string;
  models: Models;
  scope: { ownerId: string; executionId: string; stepId: string; planVersion: number; authorityKey: string };
  model: ModelRef;
  instructions: string;
  tools: readonly AgentTool[];
  /** Immutable context at admission; it never includes transient run controls. */
  initialMessages?: readonly Message[];
  /** Reconciled from committed entries on every open, including answered submissions. */
  projectEntry?: (entry: EntryRecord, sourceId: string) => Promise<void>;
  /** Native live events and the committed snapshot used to rebuild the host display. */
  onEvent?: (event: AgentEvent) => Promise<void>;
  /** Request-only controls are not appended to Pi or Molibot conversation history. */
  beforeRequest?: (messages: readonly Message[], signal?: AbortSignal, api?: HookApi) => Promise<readonly Message[]>;
  /** Must verify the host service lease; Pi does not provide cross-process locking. */
  assertStorageOwnership: () => void;
  /** Checks the host's current execution authority for each actual tool call. */
  assertAuthority: (toolName: string, args: unknown) => void;
  /** The host persists a decision before returning wait; no execution intent exists yet. */
  beforeTool?: (call: ToolCall, signal?: AbortSignal, api?: HookApi) => Promise<{ kind: "allow" } | { kind: "deny"; reason: string } | { kind: "wait"; requestId: string }>;
  afterTool?: (call: ToolCall, result: ToolExecutionResult, api: HookApi) => Promise<ToolExecutionResult | void>;
  afterResponse?: import("@earendil-works/pi-durable").GenerationHooks["afterResponse"];
  beforeCompact?: import("@earendil-works/pi-durable").CompactionHooks["beforeCompact"];
  beforeExecute?: (api: ToolExecutionApi, context: import("@earendil-works/chord").Context) => Promise<void>;
  onToolApi?: (callId: string, api: ToolExecutionApi | undefined) => void;
  onRecoveryRequired?: (cause: Error) => void;
}

export interface PiDurableKernelResult {
  status: "completed" | "failed" | "waiting_for_approval" | "recovery_required" | "cancelled";
  submissionId: number;
  messages: readonly Message[];
  entries?: readonly EntryRecord[];
  error?: string;
  approvalRequestId?: string;
  uncertainToolCallIds?: readonly string[];
}

/** One persisted execution scope; Molibot owns the goal and its acceptance. */
export class PiDurableKernel {
  constructor(private readonly options: PiDurableKernelOptions) {}

  async run(input: { requestId: string; text: string; signal?: AbortSignal }): Promise<PiDurableKernelResult> {
    return this.withOwnership(input);
  }

  /** Restore the admitted input; a new Run attempt must not replace its original context. */
  async resume(input: { requestId: string; signal?: AbortSignal }): Promise<PiDurableKernelResult> {
    if (!existsSync(this.options.storagePath)) throw new Error("Pi execution has no admitted input to resume.");
    return this.withOwnership({ ...input, resume: true });
  }

  private async withOwnership(input: { requestId: string; text?: string; resume?: true; signal?: AbortSignal }): Promise<PiDurableKernelResult> {
    this.options.assertStorageOwnership();
    const release = claimPiStorage(this.options.storagePath);
    try {
      return await this.execute(input);
    } finally {
      release();
    }
  }

  private async execute(input: { requestId: string; text?: string; resume?: true; signal?: AbortSignal }): Promise<PiDurableKernelResult> {
    input.signal?.throwIfAborted();
    mkdirSync(dirname(this.options.storagePath), { recursive: true, mode: 0o700 });
    let suspend!: (requestId: string) => void;
    const suspended = new Promise<{ approvalRequestId: string }>((resolve) => { suspend = (approvalRequestId) => resolve({ approvalRequestId }); });
    let preparationRecovery: Error | undefined;
    const { registry, tools, preparedCalls } = createPiToolRegistry({ ...this.options, onRecoveryRequired: cause => {
      preparationRecovery = cause;
      this.options.onRecoveryRequired?.(cause);
      suspend("recovery_required");
    } }, suspend);
    const storage = await openNodeSqliteStorage(this.options.storagePath);
    let harness: Harness;
    try {
      harness = await Harness.open(storage, {
        models: this.options.models, registry,
        settings: { retry: { enabled: false }, compaction: { enabled: false } }
      }, BACKGROUND_CONTEXT);
    } catch (cause) {
      await storage.close(BACKGROUND_CONTEXT);
      throw cause;
    }
    let cleanupAbort: (() => void) | undefined;
    let aborting: Promise<void> | undefined;
    let ownershipTimer: ReturnType<typeof setInterval> | undefined;
    let ownershipError: Error | undefined;
    let projectionWatch: AgentEventStream | undefined;
    try {
      const { ownerId, executionId, stepId, planVersion, authorityKey } = this.options.scope;
      const selectedModel = this.options.models.getModel(this.options.model.provider, this.options.model.modelId);
      if (!selectedModel) throw new Error("The execution's pinned model is unavailable.");
      const fingerprintFor = (text: string, instructions: string, initialMessages: readonly Message[]) =>
        createHash("sha256").update(JSON.stringify({
          ownerId, executionId, stepId, planVersion, authorityKey,
          provider: this.options.model.provider, modelId: this.options.model.modelId,
          api: selectedModel.api, baseUrl: selectedModel.baseUrl,
          instructions, requestId: input.requestId, text, initialMessages,
          tools: tools.map((tool) => ({ name: tool.name, parameters: tool.parameters, replay: tool.replay }))
        })).digest("hex");
      const conversation = await harness.root(BACKGROUND_CONTEXT, {
        agent: { model: this.options.model, tools, instructions: this.options.instructions },
        init: async (tx, id) => {
          if (input.resume || input.text === undefined) throw new Error("Pi execution has no admitted input to resume.");
          const fingerprint = fingerprintFor(input.text, this.options.instructions, this.options.initialMessages ?? []);
          await tx.appendEntry(ExecutionBinding, id, { data: {
            fingerprint, requestId: input.requestId, text: input.text, instructions: this.options.instructions
          } });
          for (const message of this.options.initialMessages ?? []) {
            await tx.appendEntry(HistoryEntry, id, { model: [message] });
          }
        }
      });
      const admitted = await conversation.context(BACKGROUND_CONTEXT);
      const binding = admitted.entries.find(ExecutionBinding.is);
      if (!binding || binding.data.requestId !== input.requestId) throw new Error("Pi execution binding differs from the approved scope or request.");
      const text = input.resume ? binding.data.text : input.text!;
      const instructions = input.resume ? binding.data.instructions : this.options.instructions;
      const initialMessages = input.resume
        ? admitted.entries.filter(HistoryEntry.is).flatMap(entry => entry.model ?? [])
        : this.options.initialMessages ?? [];
      const fingerprint = fingerprintFor(text, instructions, initialMessages);
      if (binding.data.fingerprint !== fingerprint) throw new Error("Pi execution binding differs from the approved scope or request.");
      const project = async (entries: readonly EntryRecord[]) => {
        for (const entry of entries) {
          if (entry.model?.length && !HistoryEntry.is(entry)) {
            this.options.assertStorageOwnership();
            await this.options.projectEntry?.(entry, `pi:${fingerprint}:${entry.id}`);
          }
        }
      };
      const reconcile = async () => {
        const view = await conversation.context(BACKGROUND_CONTEXT);
        await project(view.entries);
        return { entries: view.entries, messages: view.entries.flatMap(entry => entry.model ?? []) };
      };
      await reconcile();
      // Do not let an interrupted result prompt the model to repeat an unsafe action.
      const inspection = await harness.inspect(BACKGROUND_CONTEXT);
      const uncertainToolCallIds: string[] = [];
      for (const { record } of inspection.tasks) {
        if (record.kind !== ToolTask.definition.name || !("checkpoint" in record.state)) continue;
        const checkpoint = record.state.checkpoint;
        if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint) || checkpoint.phase !== "execute") continue;
        const taskInput = record.input;
        if (!taskInput || typeof taskInput !== "object" || Array.isArray(taskInput)) throw new Error("Invalid persisted tool task.");
        const assistant = (await conversation.context(BACKGROUND_CONTEXT)).entries.find((entry) => entry.id === taskInput.assistant)?.model?.[0];
        const call = assistant?.role === "assistant"
          ? assistant.content.find((block) => block.type === "toolCall" && block.id === taskInput.callId)
          : undefined;
        const currentTool = call?.type === "toolCall" ? tools.find((tool) => tool.name === call.name) : undefined;
        if (checkpoint.replay !== "safe" || currentTool?.replay !== "safe") {
          uncertainToolCallIds.push(String(taskInput.callId));
        }
      }
      if (uncertainToolCallIds.length) {
        const submission = inspection.submissions.find((item) => item.requestId === input.requestId);
        if (!submission) throw new Error("Interrupted tool task has no matching submission.");
        return {
          status: "recovery_required", submissionId: submission.id, uncertainToolCallIds,
          ...await reconcile(),
          error: "External operation outcome is unknown; review it before continuing."
        };
      }
      let projectionFailure: Promise<never> = new Promise(() => undefined);
      if (this.options.projectEntry || this.options.onEvent) {
        projectionWatch = await watchEvents(harness, conversation.id, BACKGROUND_CONTEXT);
        await project(projectionWatch.snapshot.entries);
        await this.options.onEvent?.(projectionWatch.snapshot);
        projectionWatch.start(async events => {
          for (const event of events) {
            if (event.type === "snapshot") await project(event.entries);
            else if (event.type === "entry_appended") await project([event.entry]);
            await this.options.onEvent?.(event);
          }
        });
        projectionFailure = projectionWatch.closed.then(end => {
          if (end.reason === "listener_error") throw end.error;
          return new Promise<never>(() => undefined);
        });
        void projectionFailure.catch(() => undefined);
      }
      const submission = await conversation.submit({ type: "input", requestId: input.requestId, content: text }, BACKGROUND_CONTEXT);
      const abort = () => {
        aborting ??= conversation.abort(BACKGROUND_CONTEXT, { background: true });
        // The finalizer observes failures; attach now so a rejected abort is not unhandled.
        void aborting.catch(() => undefined);
      };
      ownershipTimer = setInterval(() => {
        try {
          this.options.assertStorageOwnership();
        } catch (cause) {
          ownershipError ??= cause instanceof Error ? cause : new Error(String(cause));
          abort();
        }
      }, 250);
      if (input.signal?.aborted) abort();
      else if (input.signal) {
        input.signal.addEventListener("abort", abort, { once: true });
        cleanupAbort = () => input.signal!.removeEventListener("abort", abort);
      }
      const settled = await Promise.race([submission.wait(BACKGROUND_CONTEXT), suspended, projectionFailure]);
      if (ownershipError) throw ownershipError;
      // Stop the live observer before the final full reconciliation; its callback
      // must not race the same host projection writer or outlive this invocation.
      if (projectionWatch) {
        const end = await projectionWatch.stop();
        if (end.reason === "listener_error") throw end.error;
      }
      if ("approvalRequestId" in settled) {
        if (preparationRecovery) return { status: "recovery_required", error: preparationRecovery.message,
          submissionId: submission.id, ...await reconcile() };
        return {
          status: "waiting_for_approval", approvalRequestId: settled.approvalRequestId,
          submissionId: submission.id, ...await reconcile()
        };
      }
      return {
        status: settled.status === "done" ? "completed"
          : settled.status === "unanswered" && settled.reason === "aborted" ? "cancelled" : "failed",
        submissionId: submission.id,
        error: settled.status === "unanswered" ? `${settled.reason}: ${settled.detail ?? ""}` : undefined,
        ...await reconcile()
      };
    } finally {
      cleanupAbort?.();
      if (ownershipTimer) clearInterval(ownershipTimer);
      try {
        const cancellations = await Promise.allSettled([...preparedCalls.values()].map(async prepared => {
          if ("execute" in prepared) prepared.cancel();
        }));
        try {
          if (projectionWatch) await projectionWatch.stop();
        } finally {
          if (aborting) await aborting;
        }
        const failures = cancellations.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length) throw new AggregateError(failures, "Prepared tool cleanup failed.");
      } finally {
        await harness.close(BACKGROUND_CONTEXT);
      }
    }
  }
}

/** The same pre-intent authorization and execution boundary for every Pi conversation. */
export function createPiToolRegistry(options: PiDurableKernelOptions, suspend: (requestId: string, detail?: { call: ToolCall; result: HostToolResult }) => void) {
    const registry = createRegistry();
    const preparedCalls = new Map<string, PreparedAgentInvocation | HostToolResult>();
    const progressSinks = new Map<string, (update: AgentToolResult<unknown>) => void>();
    const makeTool = (tool: AgentTool) => defineTool({
      name: tool.name, description: tool.description, parameters: tool.parameters,
      replay: tool.replay === "safe" ? "safe" : "unsafe",
      // Authorization can suspend before intent; the rest of that batch must not start.
      executionMode: options.beforeTool || hasToolPreparation(tool) ? "sequential" : tool.executionMode,
      prepareArguments: tool.prepareArguments,
      execute: async (args, api, context) => {
        options.assertStorageOwnership();
        await options.beforeExecute?.(api, context);
        options.assertAuthority(tool.name, args);
        const onUpdate = (update: AgentToolResult<unknown>) => {
          for (const content of update.content) if (content.type === "text") api.output(content.text);
        };
        const invocationKey = `${api.taskId}:${api.callId}`;
        const prepared = preparedCalls.get(invocationKey);
        preparedCalls.delete(invocationKey);
        progressSinks.set(invocationKey, onUpdate);
        let result: HostToolResult;
        try {
          options.onToolApi?.(api.callId, api);
          const execute = async () => prepared
            ? "execute" in prepared ? await prepared.execute() : prepared
            : await tool.execute(api.callId, args, context.abortSignal, onUpdate);
          result = await withPiInvocation({ api, context, child: child => {
            if (!options.child) throw new Error("Native child execution is unavailable.");
            return options.child({ api, context }, child);
          }, nested: (target, id, input) => {
            if (!options.nested) throw new Error("Native nested execution is unavailable.");
            return options.nested({ api, context }, target, id, input);
          } }, execute);
        } catch (cause) {
          if (cause instanceof PiPreparationRecoveryError) {
            options.onRecoveryRequired?.(cause);
            await awaitWithContext(new Promise<never>(() => undefined), context);
          }
          throw cause;
        } finally {
          try { if (prepared && "execute" in prepared) prepared.cancel(); }
          finally { try { options.onToolApi?.(api.callId, undefined); } finally { progressSinks.delete(invocationKey); } }
        }
        return {
          content: result.content,
          details: encodePiToolDetails(result),
          isError: result.isError, usage: result.usage,
          control: result.terminate ? { terminate: true as const } : undefined
        };
      }
    });
    let tools = options.tools.map(makeTool);
    const install = () => registry.install(defineExtension({
      name: options.extensionName ?? "molibot", tools,
      hooks: [hook(CompactionTask, { beforeCompact: async (compaction, api, context) => {
        try {
          options.assertStorageOwnership();
          return await options.beforeCompact?.(compaction, api, context);
        } catch (cause) {
          options.onRecoveryRequired?.(cause instanceof Error ? cause : new Error(String(cause)));
          await awaitWithContext(new Promise<never>(() => undefined), context);
          return { decline: true };
        }
      } }), hook(GenerationTask, {
        beforeRequest: async (request, api, context) => {
          try {
            options.assertStorageOwnership();
            context.abortSignal?.throwIfAborted();
            const messages = await options.beforeRequest?.(request.messages, context.abortSignal, api);
            options.assertStorageOwnership();
            context.abortSignal?.throwIfAborted();
            return messages ? { messages } : undefined;
          } catch (cause) {
            // Pi reports hook errors and continues. Host admission failures must stop before a provider request.
            options.onRecoveryRequired?.(cause instanceof Error ? cause : new Error(String(cause)));
            await awaitWithContext(new Promise<never>(() => undefined), context);
            return undefined;
          }
        },
        afterResponse: (message, api, context) => options.afterResponse?.(message, api, context)
      }), hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          options.assertStorageOwnership();
          options.assertAuthority(call.name, call.arguments);
          const decision = await options.beforeTool?.(call, context.abortSignal, api);
          options.assertStorageOwnership();
          context.abortSignal?.throwIfAborted();
          options.assertAuthority(call.name, call.arguments);
          if (decision?.kind === "deny") return { block: decision.reason };
          if (decision?.kind === "wait") {
            suspend(decision.requestId);
            // Closing the Harness interrupts this hook before it commits an intent.
            await awaitWithContext(new Promise<never>(() => undefined), context);
          }
          const tool = options.tools.find(tool => tool.name === call.name);
          if (tool && hasToolPreparation(tool)) {
            const approvalRequestId = await api.memo<string>("molibot.approval-request", context);
            let prepared: PreparedAgentInvocation | HostToolResult;
            try { prepared = await tool.prepareInvocation(call.id, call.arguments, context.abortSignal,
              update => progressSinks.get(`${api.taskId}:${call.id}`)?.(update), approvalRequestId,
              createPiPreparationEffects(api, context, () => {
                options.assertStorageOwnership();
                options.assertAuthority(call.name, call.arguments);
              })); }
            catch (cause) {
              if (cause instanceof PiPreparationRecoveryError) {
                options.onRecoveryRequired?.(cause);
                // Keep the original ToolTask before intent; a model retry must not conceal an unknown effect.
                await awaitWithContext(new Promise<never>(() => undefined), context);
              }
              throw cause;
            }
            try {
              options.assertStorageOwnership();
              context.abortSignal?.throwIfAborted();
              options.assertAuthority(call.name, call.arguments);
            } catch (cause) {
              if ("execute" in prepared) prepared.cancel();
              throw cause;
            }
            if (!("execute" in prepared)) {
              if (prepared.terminate && prepared.metadata?.status === "waiting_for_approval") {
                const requestId = prepared.metadata.approvalRequestId;
                if (typeof requestId !== "string" || !requestId) throw new Error("Tool approval suspension has no request identity.");
                await api.memo("molibot.approval-request", requestId, context);
                suspend(requestId, { call, result: prepared });
                await awaitWithContext(new Promise<never>(() => undefined), context);
              }
              if (prepared.isError || prepared.error) return { block: prepared.error ?? "Tool authorization was denied." };
            }
            preparedCalls.set(`${api.taskId}:${call.id}`, prepared);
          }
          return undefined;
        },
        afterTool: async (call, result, api) => { const override = await options.afterTool?.(call, result, api); return override ?? undefined; }
      })]
    }));
  install();
  return { registry, get tools() { return tools; }, preparedCalls,
    registerTools(input: readonly AgentTool[]) {
      options.tools = input;
      tools = input.map(makeTool);
      install();
    }
  };
}
