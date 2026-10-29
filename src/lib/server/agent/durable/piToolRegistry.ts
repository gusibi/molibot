import { withPiInvocation, type NativeInvocation } from "./piInvocation.js";
import { resolve } from "node:path";
import { awaitWithContext } from "@earendil-works/chord/context";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, Models, ToolCall } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool, GenerationTask, CompactionTask, ToolTask, hook, type AgentEvent, type EntryRecord, type ModelRef, type HookApi, type ToolExecutionApi, type ToolExecutionResult, type ToolRegistration } from "@earendil-works/pi-durable";
import { encodePiToolDetails } from "./piToolResult.js";
import { createPiPreparationEffects, PiPreparationRecoveryError } from "./piPreparationEffects.js";
import { hasToolPreparation, type HostToolResult, type PreparedAgentInvocation } from "$lib/server/agent/tools/preparedTool.js";

const activeStoragePaths = new Set<string>();

export function claimPiStorage(path: string): () => void {
  const key = resolve(path);
  if (activeStoragePaths.has(key)) throw new Error("Pi execution storage is already active.");
  activeStoragePaths.add(key);
  let released = false;
  return () => { if (!released) { released = true; activeStoragePaths.delete(key); } };
}

export interface PiToolRegistryOptions {
  nested?: (invocation: Pick<NativeInvocation, "api" | "context">, tool: AgentTool, id: string, args: unknown, signal?: AbortSignal) => ReturnType<NativeInvocation["nested"]>;
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
  onRecoveryRequired?: (cause: Error, conversationId?: number) => void;
}

/** The same pre-intent authorization and execution boundary for every Pi conversation. */
export function createPiToolRegistry(options: PiToolRegistryOptions, suspend: (requestId: string, detail?: { call: ToolCall; result: HostToolResult }) => void) {
    const registry = createRegistry();
    const preparedCalls = new Map<string, PreparedAgentInvocation | HostToolResult>();
    const progressSinks = new Map<string, (update: AgentToolResult<unknown>) => void>();
    const startedCalls = new Set<string>();
    let eventDelivery = Promise.resolve();
    const emitEvent = (event: AgentEvent): Promise<void> => {
      if (event.type === "tool_execution_start") {
        if (startedCalls.has(event.toolCallId)) return eventDelivery;
        startedCalls.add(event.toolCallId);
      } else if (event.type === "tool_execution_end") startedCalls.delete(event.toolCallId);
      eventDelivery = eventDelivery.then(async () => { await options.onEvent?.(event); });
      void eventDelivery.catch(() => {});
      return eventDelivery;
    };
    const makeTool = (tool: AgentTool) => defineTool({
      name: tool.name, description: tool.description, parameters: tool.parameters,
      replay: tool.replay === "safe" ? "safe" : "unsafe",
      outputLimits: (tool as AgentTool & Pick<ToolRegistration, "outputLimits">).outputLimits ?? { maxBytes: 4_000, maxLines: 100, retain: "tail" },
      // Authorization can suspend before intent; the rest of that batch must not start.
      executionMode: options.beforeTool || hasToolPreparation(tool) ? "sequential" : tool.executionMode,
      prepareArguments: tool.prepareArguments,
      callers: (tool as AgentTool & Pick<ToolRegistration, "callers">).callers,
      constrainedSampling: tool.constrainedSampling,
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
          result = await withPiInvocation({ storagePath: options.storagePath, api, context, child: child => {
            if (!options.child) throw new Error("Native child execution is unavailable.");
            return options.child({ api, context }, child);
          }, nested: (target, id, input, signal) => {
            if (!options.nested) throw new Error("Native nested execution is unavailable.");
            return options.nested({ api, context }, target, id, input, signal);
          } }, execute);
        } catch (cause) {
          if (cause instanceof PiPreparationRecoveryError) {
            options.onRecoveryRequired?.(cause, api.conversationId);
            await awaitWithContext(new Promise<never>(() => undefined), context);
          }
          throw cause;
        } finally {
          try { if (prepared && "execute" in prepared) prepared.cancel(); }
          finally { try { options.onToolApi?.(api.callId, undefined); } finally { progressSinks.delete(invocationKey); } }
        }
        return {
          // pi-durable 1.3 reads tool content from `output`; a `content` field would be ignored.
          output: result.content,
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
          options.onRecoveryRequired?.(cause instanceof Error ? cause : new Error(String(cause)), api.conversationId);
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
            options.onRecoveryRequired?.(cause instanceof Error ? cause : new Error(String(cause)), api.conversationId);
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
            // Restricted bash can execute before intent while probing the sandbox.
            // Its output must reach the live view before the execute-phase sink exists.
            await emitEvent({ type: "tool_execution_start", toolCallId: call.id, toolName: call.name, args: JSON.parse(JSON.stringify(call.arguments)) });
            try { prepared = await tool.prepareInvocation(call.id, call.arguments, context.abortSignal,
              update => {
                const sink = progressSinks.get(`${api.taskId}:${call.id}`);
                if (sink) { sink(update); return; }
                const text = update.content.filter(content => content.type === "text").map(content => content.text).join("\n");
                void emitEvent({ type: "tool_execution_update", toolCallId: call.id, toolName: call.name, output: { set: text } });
              }, approvalRequestId,
              createPiPreparationEffects(api, context, () => {
                options.assertStorageOwnership();
                options.assertAuthority(call.name, call.arguments);
              })); }
            catch (cause) {
              if (cause instanceof PiPreparationRecoveryError) {
                options.onRecoveryRequired?.(cause, api.conversationId);
                // Keep the original ToolTask before intent; a model retry must not conceal an unknown effect.
                await awaitWithContext(new Promise<never>(() => undefined), context);
              }
              throw cause;
            }
            await eventDelivery;
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
  return { registry, get tools() { return tools; }, preparedCalls, emitEvent,
    registerTools(input: readonly AgentTool[]) {
      options.tools = input;
      tools = input.map(makeTool);
      install();
    }
  };
}
