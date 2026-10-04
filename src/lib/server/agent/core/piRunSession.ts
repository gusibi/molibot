import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createModels, createAssistantMessageEventStream, type SimpleStreamOptions, type AssistantMessage, type AssistantMessageEvent, type ImageContent, type Message, type Model } from "@earendil-works/pi-ai";
import type { AgentOptions, AgentState, AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentEvent as PiEvent, ModelRef } from "@earendil-works/pi-durable";
import { PiConversationRuntime, type PiConversationOptions } from "$lib/server/agent/durable/piConversation.js";
import { decodePiToolDetails, encodePiToolDetails } from "$lib/server/agent/durable/piToolResult.js";
import { getPiModels, SESSION_AFFINITY_HEADER } from "$lib/server/providers/piRuntime.js";
import { stripTransientRuntimeNoticesFromMessages } from "./runtimeNotices.js";

export interface PiRunBinding {
  storagePath: string;
  requestId: string;
  scope: PiConversationOptions["scope"];
  admissionKey: string;
  runId?: string;
  models: readonly Model<any>[];
  assertStorageOwnership: () => void;
  assertAuthority: PiConversationOptions["assertAuthority"];
  recoverTools?: PiConversationOptions["recoverTools"];
  beforeGeneration?: (taskId: string) => void;
  onDeferredCancel?: (outcome: "requested" | "unsupported" | "failed") => Promise<void>;
  onDeferred?: (pollAt: number, taskId?: string) => Promise<void>;
  childTools?: PiConversationOptions["childTools"];
  childCompaction?: PiConversationOptions["childCompaction"];
  childBudgetLimits?: PiConversationOptions["childBudgetLimits"];
  onChildUsage?: PiConversationOptions["onChildUsage"];
  onChildTrace?: PiConversationOptions["onChildTrace"];
  beforeChildTool?: PiConversationOptions["beforeChildTool"];
  afterChildTool?: PiConversationOptions["afterChildTool"];
}

/** Product-facing view and callbacks over a native Pi conversation. No agent loop runs here. */
export class PiRunSession {
  readonly state: AgentState;
  sessionId?: string;
  transport: AgentOptions["transport"];
  beforeToolCall: AgentOptions["beforeToolCall"];
  afterToolCall: AgentOptions["afterToolCall"];
  streamFunction: AgentOptions["streamFn"];
  onPayload: AgentOptions["onPayload"];
  onResponse: AgentOptions["onResponse"];
  private binding?: PiRunBinding;
  private runtime?: PiConversationRuntime;
  private listeners = new Set<(event: AgentEvent, signal: AbortSignal) => void | Promise<void>>();
  private controller = new AbortController();
  private projected = new Set<number>();
  private sourceIds = new WeakMap<object, string>();
  private partial?: AssistantMessage;
  private queued: { mode: "steer" | "followUp"; message: AgentMessage; requestId: string }[] = [];
  private transient: AgentMessage[] = [];
  private primaryAdmitted = false;
  private toolArgs = new Map<string, unknown>();
  private toolOrigins = new Map<string, AssistantMessage>();
  private accepting = false;
  hasDeferred = false;
  private ownedModels: Model<any>[] = [];
  private registerProvider?: (provider: string) => void;
  private configuration: Promise<void> = Promise.resolve();

  constructor(private readonly options: AgentOptions) {
    const initial = options.initialState!;
    this.state = { systemPrompt: initial.systemPrompt ?? "", model: initial.model!, thinkingLevel: initial.thinkingLevel ?? "off",
      tools: initial.tools ?? [], messages: initial.messages ?? [], isStreaming: false, pendingToolCalls: new Set() };
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.streamFunction = options.streamFn;
    this.onPayload = options.onPayload;
    this.onResponse = options.onResponse;
    this.sessionId = options.sessionId;
    this.transport = options.transport;
  }

  get signal(): AbortSignal { return this.controller.signal; }
  startTurn(): void { this.accepting = true; this.controller = new AbortController(); }
  bindRun(binding: PiRunBinding): void { this.binding = binding; this.primaryAdmitted = false; this.hasDeferred = false; }
  get projectionRunId(): string | undefined { return this.runtime?.projectionRunId; }
  get isRecovering(): boolean { return Boolean(this.binding && existsSync(this.binding.storagePath)); }
  toolOriginFor(callId: string): AssistantMessage | undefined { return this.toolOrigins.get(callId); }
  sourceIdFor(message: AgentMessage): string | undefined { return this.sourceIds.get(message); }
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private async emit(event: AgentEvent): Promise<void> {
    for (const listener of this.listeners) await listener(event, this.controller.signal);
  }

  updateTools(tools: readonly AgentTool[]): Promise<void> {
    this.state.tools = [...tools];
    if (!this.runtime) return Promise.resolve();
    this.configuration = this.configuration.then(async () => {
      this.runtime!.registerTools(tools);
      await this.runtime!.configure({ tools: tools.map(tool => tool.name) });
    });
    return this.configuration;
  }

  private async refresh(): Promise<void> {
    if (!this.runtime) return;
    const context = await this.runtime.context();
    this.state.messages = context.entries.flatMap(entry => entry.model ?? []).filter(message => message.role !== "system") as AgentMessage[];
  }

  private createModels() {
    const models = createModels();
    const installed = new Set<string>();
    this.registerProvider = provider => {
      if (installed.has(provider)) return;
      installed.add(provider);
      const stream = (model: Model<any>, context: Parameters<NonNullable<AgentOptions["streamFn"]>>[1], streamOptions?: SimpleStreamOptions) => {
        const output = createAssistantMessageEventStream();
        void Promise.resolve().then(() => this.streamFunction(model, context, {
          ...streamOptions, sessionId: this.sessionId, transport: this.transport,
          onPayload: this.onPayload, onResponse: this.onResponse
        })).then(async source => {
          let terminal = false;
          for await (const event of source) { output.push(event); terminal ||= event.type === "done" || event.type === "error"; }
          const final = await source.result();
          if (!terminal && final.stopReason === "pending") throw new Error("Provider stream ended with a non-terminal pending response.");
          if (!terminal && final.stopReason !== "pending") output.push(final.stopReason === "error" || final.stopReason === "aborted"
            ? { type: "error", reason: final.stopReason, error: final }
            : { type: "done", reason: final.stopReason, message: final });
          output.end(final);
        }).catch(cause => output.end({ role: "assistant", content: [], api: model.api, provider: model.provider,
          model: model.id, timestamp: Date.now(), stopReason: "error", errorMessage: String(cause),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
        return output;
      };
      models.setProvider({ id: provider, name: provider, getModels: () => {
          const candidates = [...getPiModels().getModels(provider), ...this.ownedModels, ...this.binding!.models].filter(model => model.provider === provider);
          return [...new Map(candidates.map(model => [model.id, model])).values()];
        },
        auth: { apiKey: { name: "Molibot runtime credentials", resolve: async () => {
          const key = await this.options.getApiKey?.(provider);
          return { auth: key ? { apiKey: key } : {} };
        } } },
        stream: (model, context, opts) => {
          const { toolChoice: _toolChoice, ...common } = opts ?? {};
          return stream(model, context, common);
        }, streamSimple: stream,
        fetchDeferred: (model, handle, opts) => getPiModels().streamDeferred(model, handle, {
          ...opts, headers: { ...opts?.headers, ...(this.sessionId ? { [SESSION_AFFINITY_HEADER]: this.sessionId } : {}) },
          onPayload: this.onPayload, onResponse: this.onResponse
        }),
        cancelDeferred: async (model, handle, opts) => {
          if (!getPiModels().getProvider(model.provider)?.cancelDeferred) {
            await this.binding?.onDeferredCancel?.("unsupported");
            throw new Error("Provider does not support remote cancellation; the remote task may still incur charges.");
          }
          try {
            await getPiModels().cancelDeferred(model, handle, {
              ...opts, headers: { ...opts?.headers, ...(this.sessionId ? { [SESSION_AFFINITY_HEADER]: this.sessionId } : {}) },
              onPayload: this.onPayload, onResponse: this.onResponse
            });
            await this.binding?.onDeferredCancel?.("requested");
          } catch (error) { await this.binding?.onDeferredCancel?.("failed"); throw error; }
        }
      });
    };
    for (const provider of new Set(this.binding!.models.map(model => model.provider))) this.registerProvider(provider);
    return models;
  }

  async prompt(text: string, images: ImageContent[] = []): Promise<void> {
    this.controller.signal.throwIfAborted();
    if (!this.binding) throw new Error("Pi run admission is not bound.");
    if (!this.runtime) {
      const initialMessages = this.state.messages.filter(message => message.role !== "system") as Message[];
      const content = images.length ? [{ type: "text" as const, text }, ...images] : text;
      const model = this.state.model;
      const allowedModels: ModelRef[] = this.binding.models.map(model => ({ provider: model.provider, modelId: model.id }));
      this.runtime = new PiConversationRuntime({
        storagePath: this.binding.storagePath, scope: this.binding.scope, admissionKey: this.binding.admissionKey, projectionRunId: this.binding.runId,
        assertStorageOwnership: this.binding.assertStorageOwnership, assertAuthority: this.binding.assertAuthority,
        recoverTools: this.binding.recoverTools, models: this.createModels(),
        childTools: this.binding.childTools, childCompaction: this.binding.childCompaction, childBudgetLimits: this.binding.childBudgetLimits,
        registerModel: model => {
          const admitted = [...this.binding!.models, ...this.ownedModels].find(candidate => candidate.provider === model.provider && candidate.id === model.id);
          if (admitted && (admitted.api !== model.api || admitted.baseUrl !== model.baseUrl)) throw new Error("An admitted model endpoint changed during recovery.");
          if (!admitted) this.ownedModels.push(model);
          this.registerProvider?.(model.provider);
        },
        beforeChildGeneration: taskId => this.binding!.beforeGeneration?.(`pi:${this.binding!.requestId}:${taskId}`),
        onChildDeferred: async pollAt => { this.hasDeferred = true; await this.binding?.onDeferred?.(pollAt); },
        onChildTrace: this.binding.onChildTrace, onChildUsage: this.binding.onChildUsage, beforeChildTool: this.binding.beforeChildTool, afterChildTool: this.binding.afterChildTool, model: { provider: model.provider, modelId: model.id },
        allowedModels, instructions: this.state.systemPrompt, tools: this.state.tools, initialMessages,
        afterResponse: async message => { if (message.stopReason === "deferred") this.hasDeferred = true; },
        beforeRequest: async (messages, _signal, api) => {
          if (!api) throw new Error("Pi generation has no native task identity.");
          this.binding!.beforeGeneration?.(`pi:${this.binding!.requestId}:generation:${api.taskId}`);
          this.controller.signal.throwIfAborted();
          await this.configuration;
          let requestMessages = this.options.prepareRequest ? messages.filter(message => message.role !== "system") : [...messages];
          if (this.transient.length) requestMessages.push(...this.transient.splice(0) as Message[]);
          if (this.options.prepareRequest) {
            const prepared = await this.options.prepareRequest({ model: this.state.model, context: { ...this.state, messages: requestMessages }, thinkingLevel: this.state.thinkingLevel }, this.controller.signal);
            requestMessages = prepared?.context?.messages ? this.options.convertToLlm
              ? await this.options.convertToLlm(prepared.context.messages) : prepared.context.messages.filter((message): message is Message =>
                message.role === "system" || message.role === "user" || message.role === "assistant" || message.role === "toolResult") : requestMessages;
          }
          return requestMessages;
        },
        beforeTool: async (call, signal, api) => {
          await this.refresh();
          if (!api) throw new Error("Pi tool hook has no native task identity.");
          const assistantMessage = await this.runtime!.toolOrigin(api.taskId, call.id);
          const decision = await this.beforeToolCall?.({ assistantMessage, toolCall: call, args: call.arguments, context: this.state }, signal);
          await this.updateTools(this.state.tools);
          return decision?.block ? { kind: "deny", reason: decision.reason ?? "Tool execution was denied." } : { kind: "allow" };
        },
        afterTool: async (call, result, api) => {
          await this.refresh();
          const assistantMessage = await this.runtime!.toolOrigin(api.taskId, call.id);
          const hostResult = { content: result.content ?? [], ...decodePiToolDetails(result.details), usage: result.usage, isError: result.isError };
          const override = await this.afterToolCall?.({ assistantMessage, toolCall: call, args: call.arguments, context: this.state,
            result: hostResult, isError: Boolean(result.isError) }, this.controller.signal);
          await this.updateTools(this.state.tools);
          if (override) {
            const merged = { ...hostResult, ...override };
            return { ...result, content: merged.content, details: encodePiToolDetails(merged), usage: merged.usage,
              isError: merged.isError, control: { ...result.control, terminate: merged.terminate ? true as const : undefined } };
          }
        },
        projectEntry: async (entry, sourceId, input) => {
          if (this.projected.has(entry.id)) return;
          await this.refresh();
          for (const message of entry.model ?? []) {
            this.sourceIds.set(message, sourceId);
            if (message.role === "system" || input?.primary || input?.mode === "steer") continue;
            if (message.role === "assistant" && !this.partial) await this.emit({ type: "message_start", message });
            await this.emit({ type: "message_end", message });
            if (message.role === "assistant") this.partial = undefined;
          }
          this.projected.add(entry.id);
        },
        onEvent: event => this.nativeEvent(event),
        onSuspended: async (requestId, detail) => {
          if (detail) await this.emit({ type: "tool_execution_end", toolCallId: detail.call.id, toolName: detail.call.name,
            result: detail.result, isError: true });
          else throw new Error(`Pi approval ${requestId} has no tool result.`);
        }
      });
      (this.state as { isStreaming: boolean }).isStreaming = true;
      await this.emit({ type: "agent_start" });
      const abort = () => { void this.runtime?.abort().catch(() => undefined); };
      this.controller.signal.addEventListener("abort", abort, { once: true });
      try {
        await this.runtime.open({ requestId: this.binding.requestId, content, resume: this.isRecovering });
        this.controller.signal.throwIfAborted();
        await this.runtime.configure({ thinkingLevel: this.state.thinkingLevel });
        this.controller.signal.throwIfAborted();
        await this.runtime.runInput(async () => { this.primaryAdmitted = true; await this.flushQueued(); });
        await this.refresh();
      } finally { this.controller.signal.removeEventListener("abort", abort); await this.emit({ type: "agent_end", messages: this.state.messages }); }
    } else {
      const admitted = this.runtime.admittedInput;
      const original = typeof admitted === "string" ? admitted : admitted?.filter(block => block.type === "text").map(block => block.text).join("\n") ?? "";
      const control = text.startsWith(original) ? text.slice(original.length).trim() : text;
      if (control) this.transient.push({ role: "user", content: [{ type: "text", text: control }], timestamp: Date.now() });
      await this.continue();
    }
  }

  async replaceContext(messages: AgentMessage[]): Promise<void> {
    if (this.runtime) await this.runtime.replaceContext(messages as Message[]);
    this.state.messages = messages;
  }

  async continue(): Promise<void> {
    this.controller.signal.throwIfAborted();
    if (!this.runtime || !this.binding) throw new Error("Pi conversation is not open.");
    await this.configuration;
    await this.runtime.configure({ model: { provider: this.state.model.provider, modelId: this.state.model.id },
      thinkingLevel: this.state.thinkingLevel, tools: this.state.tools.map(tool => tool.name) });
    const context = await this.runtime.context();
    const id = `continue:${context.entries.at(-1)?.id ?? 0}:${this.state.model.provider}:${this.state.model.id}`;
    await this.runtime.continue(id);
    await this.refresh();
  }

  private queue(mode: "steer" | "followUp", message: AgentMessage): boolean {
    if (!this.accepting || this.controller.signal.aborted) return false;
    if (mode === "steer" && stripTransientRuntimeNoticesFromMessages([message]).length === 0) this.transient.push(message);
    else this.queued.push({ mode, message, requestId: `control:${mode}:${randomUUID()}` });
    if (this.runtime && this.primaryAdmitted) void this.flushQueued().catch(() => this.abort());
    return true;
  }
  steer(message: AgentMessage): boolean { return this.queue("steer", message); }
  followUp(message: AgentMessage): boolean { return this.queue("followUp", message); }
  private async flushQueued(): Promise<void> {
    while (this.queued.length) {
      const input = this.queued.shift()!;
      if (input.message.role !== "user") throw new Error("Live input must be a user message.");
      await this.runtime!.submit({ requestId: input.requestId, content: input.message.content, whenBusy: input.mode });
    }
  }
  clearSteeringQueue(): void { this.transient = []; this.queued = this.queued.filter(input => input.mode !== "steer"); }
  clearAllQueues(): void { this.transient = []; this.queued = []; }
  abort(): void { this.accepting = false; this.controller.abort(); void this.runtime?.abort().catch(() => undefined); }

  private async nativeEvent(event: PiEvent): Promise<void> {
    if (event.type === "deferred_poll" || (event.type === "snapshot" && event.generation?.deferred)) {
      this.hasDeferred = true;
      await this.binding?.onDeferred?.(event.type === "deferred_poll" ? event.pollAt : event.generation!.deferred!.pollAt, await this.runtime?.generationTaskId());
    } else if (event.type === "message_start" && event.message.role === "assistant") {
      this.partial = structuredClone(event.message); await this.emit({ type: "message_start", message: this.partial });
    } else if (event.type === "message_update" && this.partial) {
      this.partial.usage = event.usage;
      for (const change of event.changes) {
        if (change.type === "message") this.partial = structuredClone(change.message);
        else if ("block" in change) this.partial.content[change.contentIndex] = structuredClone(change.block);
        else if (change.type === "text_delta" || change.type === "thinking_delta") {
          const block = this.partial.content[change.contentIndex];
          if (change.type === "text_delta" && block?.type === "text") block.text += change.delta;
          if (change.type === "thinking_delta" && block?.type === "thinking") block.thinking += change.delta;
          const assistantMessageEvent: AssistantMessageEvent = { ...change, partial: this.partial };
          await this.emit({ type: "message_update", message: this.partial, assistantMessageEvent });
        }
      }
    } else if (event.type === "tool_execution_start") { this.toolArgs.set(event.toolCallId, event.args); await this.emit(event); }
    else if (event.type === "tool_execution_update") {
      const text = event.output && ("set" in event.output ? event.output.set : event.output.append);
      await this.emit({ type: "tool_execution_update", toolCallId: event.toolCallId, toolName: event.toolName, args: this.toolArgs.get(event.toolCallId),
        partialResult: { content: text ? [{ type: "text", text }] : [], details: event.details } });
    } else if (event.type === "tool_execution_end" && event.entry) {
      const context = await this.runtime!.context();
      const index = context.entries.findIndex(entry => entry.id === event.entry?.id);
      const origin = context.entries.slice(0, index < 0 ? undefined : index).flatMap(entry => entry.model ?? []).reverse()
        .find((message): message is AssistantMessage => message.role === "assistant" && message.content.some(block => block.type === "toolCall" && block.id === event.toolCallId));
      if (origin) this.toolOrigins.set(event.toolCallId, origin);
      const message = event.entry?.model?.find(message => message.role === "toolResult");
      await this.emit({ type: "tool_execution_end", toolCallId: event.toolCallId, toolName: event.toolName,
        result: { content: message?.content ?? [{ type: "text", text: "Tool execution ended without a committed result." }], ...decodePiToolDetails(message?.details) },
        isError: message?.isError ?? true });
    }
  }

  async close(): Promise<void> {
    this.accepting = false;
    (this.state as { isStreaming: boolean }).isStreaming = false;
    this.clearAllQueues();
    try { await this.runtime?.close(); }
    finally { this.runtime = undefined; this.binding = undefined; this.projected.clear(); this.partial = undefined; this.toolArgs.clear(); this.toolOrigins.clear(); this.primaryAdmitted = false; this.configuration = Promise.resolve(); this.ownedModels = []; this.registerProvider = undefined; }
  }
}
