import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { JsonValue, JsonRepresentation } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { RunBudget } from "$lib/server/agent/core/runtimeBudget.js";
import { RunBudgetStore } from "$lib/server/agent/core/runBudgetStore.js";
import { join } from "node:path";
import { defineDoc, defineEntry, GenerationTask, Harness, LiveDoc, ToolTask, watchEvents,
  AssistantEntry, UsageDoc, AgentDoc, configure as configureAgent, type AgentChange, type AgentEventStream, type Conversation, type EntryRecord, type ModelRef,
  type UserInput, type Cursor, type TaskId, type EntryId, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { NativeInvocation, NativeChildOptions, NativeChildSession } from "./piInvocation.js";
import { decodePiToolDetails } from "./piToolResult.js";
import { isSafeReadOnlySubagentCommand } from "$lib/server/agent/tools/subagent.js";
import { assistantHasUsableOutput, planLengthRecovery } from "$lib/server/agent/tools/subagentRuntime.js";
import { claimPiStorage, createPiToolRegistry, type PiDurableKernelOptions } from "./piKernel.js";

const ChildPolicy = defineDoc<{ deadlineAt: number }>({ kind: "molibot.child-policy", version: 1,
  scope: "conversation", history: "latest", fork: "current", initial: () => ({ deadlineAt: 0 }) });
const ChildUsageProjection = defineDoc<{ models: Record<string, JsonRepresentation<import("@earendil-works/pi-ai").Usage>> }>({ kind: "molibot.child-usage-projection", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({ models: {} }) });
const ChildUsageReceipt = defineEntry<{ provider: string; model: string; api: string; usage: JsonValue }>("molibot.child-usage-receipt");
const NestedCall = defineEntry<{ owner: number; id: string; fingerprint: string; taskId: number }>("molibot.nested-call");
const ChildBinding = defineEntry<{ taskId: number; key: string; conversationId: number; model: JsonValue; catalog: JsonValue[]; instructions: string; tools: string[] }>("molibot.child-binding");
const Binding = defineEntry<{ key: string; requestId: string; content: JsonValue; runId: string }>("molibot.runner-binding");
const History = defineEntry("molibot.runner-history");
const Continuation = defineEntry<{ requestId: string; taskId: TaskId }>("molibot.runner-continuation");
const Control = defineEntry<{ requestId: string; mode: "steer" | "followUp" }>("molibot.runner-control");

/**
 * Recovers a model response truncated by the output-token limit that produced
 * neither text nor a tool call: its whole budget went to reasoning, so the
 * retry drops thinking and continues the committed context.
 */
const MAX_LENGTH_RETRIES = 2;

export interface PiConversationOptions extends PiDurableKernelOptions {
  /** All authorized definitions are registered, including currently deferred tools. */
  visibleTools?: readonly string[];
  childCompaction?: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
  childBudgetLimits?: import("$lib/server/agent/core/runtimeBudget.js").RunBudgetLimits;
  childTools?: () => PiDurableKernelOptions["tools"];
  registerModel?: (model: import("@earendil-works/pi-ai").Model<any>) => void;
  onChildDeferred?: (pollAt: number) => Promise<void>;
  onChildUsage?: (receipt: { id: string; provider: string; model: string; api: string; usage: import("@earendil-works/pi-ai").Usage }) => Promise<void> | void;
  onChildTrace?: (stage: "model.call.before" | "model.call.after" | "tool.call.before" | "tool.call.after" | "tool.call.error", data: Record<string, unknown>) => void;
  beforeChildGeneration?: (taskId: string) => void;
  beforeChildTool?: (taskId: string) => void;
  afterChildTool?: (taskId: string, isError: boolean) => void;
  /** Admission fixes the host-approved fallback catalog; credentials are resolved at request time. */
  allowedModels?: readonly ModelRef[];
  admissionKey?: string;
  projectionRunId?: string;
  projectEntry?: (entry: EntryRecord, sourceId: string, input?: { primary: boolean; mode?: "steer" | "followUp" }) => Promise<void>;
  onSuspended?: (requestId: string, detail?: Parameters<Parameters<typeof createPiToolRegistry>[1]>[1]) => Promise<void>;
  recoverTools?: (names: readonly string[]) => Promise<PiDurableKernelOptions["tools"]>;

}

/** Owns a native conversation; the host owns product policy and projections, not its execution loop. */
export class PiConversationRuntime {
  private harness?: Harness;
  private conversation?: Conversation;
  private registryTools?: ReturnType<typeof createPiToolRegistry>;
  private watch?: AgentEventStream;
  private childRegistries: ReturnType<typeof createPiToolRegistry>[] = [];
  private requestId?: string;
  private originRunId?: string;
  private admitted?: UserInput;
  private key?: string;
  private deferredChildren = new Set<number>();
  private projectedChildUsage = new Set<number>();
  private childParents = new Map<number, string>();
  private childStops = new Map<number, (cause: Error) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private ownershipError?: unknown;
  private aborting?: Promise<void>;
  private releaseStorage?: () => void;
  private suspensionFailure?: unknown;
  private projection: Promise<void> = Promise.resolve();
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private suspended!: Promise<{ requestId: string }>;
  private suspend!: (requestId: string) => void;

  constructor(private readonly options: PiConversationOptions) {}

  async open(input: { requestId: string; content: UserInput; resume?: boolean }): Promise<void> {
    if (this.opening || this.closing) throw new Error("Pi conversation lifecycle has already started.");
    this.opening = this.initialize(input);
    await this.opening;
    if (this.closing) throw new Error("Pi conversation closed during initialization.");
  }

  private async initialize(input: { requestId: string; content: UserInput; resume?: boolean }): Promise<void> {
    if (this.harness) throw new Error("Pi conversation is already open.");
    this.options.assertStorageOwnership();
    const path = resolve(this.options.storagePath);
    this.releaseStorage = claimPiStorage(path);
    this.suspended = new Promise(resolve => { this.suspend = requestId => resolve({ requestId }); });
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      this.registryTools = createPiToolRegistry({ ...this.options, beforeCompact: () => ({ decline: true }), child: (invocation, child) => this.childSession(invocation, child), nested: (invocation, tool, id, args) => this.nestedCall(invocation, tool, id, args), onRecoveryRequired: cause => {
        this.options.onRecoveryRequired?.(cause);
        this.suspendFailure(cause);
      } }, (requestId, detail) => {
        void Promise.resolve(this.options.onSuspended?.(requestId, detail)).then(() => this.suspend(requestId), cause => this.suspendFailure(cause));
      });
      this.installChildExtensions();
      const allowedModels = this.options.allowedModels ?? [this.options.model];
      const catalog = allowedModels.map(ref => {
        const model = this.options.models.getModel(ref.provider, ref.modelId);
        if (!model) throw new Error("An admitted model is unavailable.");
        return { ...ref, api: model.api, baseUrl: model.baseUrl };
      });
      const key = createHash("sha256").update(JSON.stringify({ scope: this.options.scope, catalog,
        admission: this.options.admissionKey ?? this.options.tools.map(tool => ({ name: tool.name, parameters: tool.parameters, replay: tool.replay })) })).digest("hex");
      const storage = await openNodeSqliteStorage(path);
      try {
      // Rebuild child model catalogs before the scheduler reserves recovered generations.
      let conversationsCursor: Cursor | undefined;
      do {
        const page = await storage.scanConversations({}, 64, conversationsCursor, BACKGROUND_CONTEXT);
        for (const conversation of page.items) {
          let cursor: Cursor | undefined;
          do {
            const entries = await storage.scanEntries({ conversationId: conversation.id }, 64, cursor, BACKGROUND_CONTEXT);
            for (const entry of entries.items) if (ChildBinding.is(entry)) {
              this.childParents.set(entry.data.conversationId, entry.data.key);
              for (const model of entry.data.catalog) this.options.registerModel?.(model as unknown as import("@earendil-works/pi-ai").Model<any>);
            }
            cursor = entries.next;
          } while (cursor !== undefined);
        }
        conversationsCursor = page.next;
      } while (conversationsCursor !== undefined);
        this.harness = await Harness.open(storage, { models: this.options.models, registry: this.registryTools.registry,
          settings: { extensions: [], retry: { enabled: false }, compaction: { ...this.options.childCompaction, enabled: this.options.childCompaction?.enabled ?? false, backgroundTokens: 0 } } }, BACKGROUND_CONTEXT);
      } catch (cause) { await storage.close(BACKGROUND_CONTEXT); throw cause; }
      this.conversation = await this.harness.root(BACKGROUND_CONTEXT, {
        agent: { extensions: [this.registryTools.registry.snapshot().extension("molibot")!], model: this.options.model, instructions: this.options.instructions, tools: this.visible(this.options.visibleTools) },
        init: async (tx, id) => {
          if (input.resume) throw new Error("Pi execution has no admitted input to resume.");
          await tx.appendEntry(Binding, id, { data: { key, requestId: input.requestId, content: JSON.parse(JSON.stringify(input.content)), runId: this.options.projectionRunId ?? this.options.scope.executionId } });
          for (const message of this.options.initialMessages ?? []) await tx.appendEntry(History, id, { model: [message] });
        }
      });
      await this.conversation.configure({ extensions: [this.registryTools.registry.snapshot().extension("molibot")!] }, BACKGROUND_CONTEXT);
      const view = await this.conversation.context(BACKGROUND_CONTEXT);
      const binding = await this.conversation.commit(async tx => {
        let cursor: Cursor | undefined;
        do {
          const page = await tx.scanEntries({ conversationId: this.conversation!.id }, 64, cursor);
          const found = page.items.find(Binding.is);
          if (found) return found;
          cursor = page.next;
        } while (cursor !== undefined);
      }, BACKGROUND_CONTEXT);
      if (!binding || binding.data.key !== key || binding.data.requestId !== input.requestId ||
          (!input.resume && JSON.stringify(binding.data.content) !== JSON.stringify(input.content))) {
        throw new Error("Pi execution binding differs from the approved scope or request.");
      }
      this.key = key;
      this.requestId = input.requestId;
      this.originRunId = binding.data.runId;
      this.admitted = JSON.parse(JSON.stringify(binding.data.content)) as UserInput;
      if (this.options.recoverTools) {
        const savedAgent = await this.harness.snapshot(AgentDoc, this.conversation.id, BACKGROUND_CONTEXT);
        const names = Array.isArray(savedAgent?.tools) ? savedAgent.tools : [];
        const recovered = await this.options.recoverTools(names);
        this.registryTools.registerTools(recovered);
      }
      for (const id of this.childParents.keys()) {
        const child = await this.harness!.conversation(id as ConversationId, BACKGROUND_CONTEXT);
        if (child) await this.projectChildUsage(child);
      }
      await this.project(view.entries);
      this.watch = await watchEvents(this.harness, this.conversation.id, BACKGROUND_CONTEXT);
      await this.project(this.watch.snapshot.entries);
      await this.options.onEvent?.(this.watch.snapshot);
      this.watch.start(events => this.serializeProjection(async () => {
        for (const event of events) {
          if (event.type === "task_failed") throw new Error(`Pi ${event.kind} failed: ${event.message}`);
          if (event.type === "entry_appended" || event.type === "message_end") await this.project([event.entry]);
          else if (event.type === "snapshot") await this.project(event.entries);
          await this.options.onEvent?.(event);
        }
      }));
      this.timer = setInterval(() => {
        try { this.options.assertStorageOwnership(); }
        catch (cause) { this.ownershipError ??= cause; void this.abort().catch(() => undefined); }
      }, 250);
    } catch (cause) { await this.closeResources(); throw cause; }
  }

  private suspendFailure(cause: unknown): void { this.suspensionFailure = cause; this.suspend("failed"); }

  registerTools(tools: PiDurableKernelOptions["tools"]): void {
    this.requireConversation();
    this.registryTools!.registerTools(tools);
  }

  private visible(names?: readonly string[]) {
    const tools = this.registryTools!.tools;
    if (!names) return tools;
    return names.map(name => {
      const tool = tools.find(tool => tool.name === name);
      if (!tool) throw new Error(`Tool ${name} is not authorized for this conversation.`);
      return tool;
    });
  }

  private requireConversation(): Conversation {
    this.options.assertStorageOwnership();
    if (this.ownershipError) throw this.ownershipError;
    if (!this.conversation || !this.harness) throw new Error("Pi conversation is not open.");
    return this.conversation;
  }

  async agent() { return this.requireConversation().agent(BACKGROUND_CONTEXT); }
  async context() { return this.requireConversation().context(BACKGROUND_CONTEXT); }

  async toolOrigin(taskId: TaskId, callId: string) {
    this.requireConversation();
    const task = await this.harness!.getTask(taskId, BACKGROUND_CONTEXT);
    const input = task?.input;
    if (task?.kind !== ToolTask.definition.name || !input || typeof input !== "object" || Array.isArray(input) || input.callId !== callId) {
      throw new Error("Pi tool has no matching native task identity.");
    }
    const entry = await this.harness!.commit(tx => tx.entry(input.assistant as EntryId), BACKGROUND_CONTEXT);
    const assistant = entry?.model?.find(message => message.role === "assistant");
    if (assistant?.role !== "assistant" || !assistant.content.some(block => block.type === "toolCall" && block.id === callId)) {
      throw new Error("Pi tool has no originating assistant entry.");
    }
    return assistant;
  }

  private async nestedCall(invocation: Pick<NativeInvocation, "api" | "context">, tool: import("@earendil-works/pi-agent-core").AgentTool, id: string, args: unknown) {
    const { api, context } = invocation;
    this.options.assertStorageOwnership();
    this.options.assertAuthority(tool.name, args);
    const fingerprint = createHash("sha256").update(JSON.stringify({ tool: tool.name, args })).digest("hex");
    this.registerTools([...this.options.tools.filter(candidate => candidate.name !== tool.name), tool]);
    const taskId = await api.commit(async tx => {
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries({ conversationId: api.conversationId }, 64, cursor);
        const existing = page.items.find(entry => NestedCall.is(entry) && entry.data.owner === api.taskId && entry.data.id === id);
        if (existing && NestedCall.is(existing)) {
          if (existing.data.fingerprint !== fingerprint) throw new Error("Nested tool sequence or arguments changed during replay.");
          return existing.data.taskId as TaskId<import("@earendil-works/pi-durable").ToolTaskResult>;
        }
        cursor = page.next;
      } while (cursor !== undefined);
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
      const extension = this.registryTools!.registry.snapshot().extension("molibot")!;
      await configureAgent(tx, child.id, { extensions: [extension], tools: this.registryTools!.tools.filter(candidate => candidate.name === tool.name) });
      const assistant = await tx.appendEntry(AssistantEntry, child.id, { model: [{ role: "assistant",
        provider: "molibot", api: "openai-completions", model: "nested-tool", timestamp: Date.now(), stopReason: "toolUse",
        content: [{ type: "toolCall", id, name: tool.name, arguments: JSON.parse(JSON.stringify(args)) }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }] });
      const taskId = await tx.createTask(ToolTask, { assistant: assistant.id, callId: id }, { conversationId: child.id, ownership: { kind: "conversation" } });
      await tx.appendEntry(NestedCall, api.conversationId, { data: { owner: api.taskId, id, fingerprint, taskId } });
      return taskId;
    }, context);
    const settled = await api.waitForTask(taskId, context);
    if (settled.state.outcome.status !== "completed") throw new Error(`Native nested tool did not commit a receipt: ${JSON.stringify(settled.state.outcome)}`);
    const entryId = settled.state.outcome.result.entryId;
    const entry = await api.commit(tx => tx.entry(entryId), context);
    const result = entry?.model?.find(message => message.role === "toolResult");
    if (!result) throw new Error("Native nested tool receipt is missing.");
    return { result: { content: result.content, ...decodePiToolDetails(result.details) }, isError: Boolean(result.isError) };
  }

  private async checkChildDeadline(api: import("@earendil-works/pi-durable").HookApi): Promise<void> {
    const policy = await api.snapshot(ChildPolicy, api.conversationId, BACKGROUND_CONTEXT);
    if (policy?.deadlineAt && Date.now() >= policy.deadlineAt) throw new Error("Subagent exceeded its original time budget.");
  }

  private childBudget(api: import("@earendil-works/pi-durable").HookApi, kind: "model" | "tool" | "result" | "failure", isError = false): void {
    if (!this.options.childBudgetLimits) return;
    const store = new RunBudgetStore(join(dirname(this.options.storagePath), "child-budgets.sqlite"),
      `${this.options.storagePath}:${api.conversationId}`, this.options.childBudgetLimits);
    try {
      const budget = new RunBudget(this.options.childBudgetLimits, store);
      if (kind === "model" && budget.getExceededReason()) throw new Error(budget.getExceededReason());
      const id = String(api.taskId);
      const result = kind === "model" ? budget.tryStartModelTurn(id) : kind === "tool" ? budget.tryStartTool(id) : kind === "failure" ? budget.tryRecordModelFailure(id) : budget.recordToolResult(isError, id);
      if (!result.ok && kind !== "result" && kind !== "failure") throw new Error(result.reason);
    } finally { store.close(); }
  }

  private async projectChildUsage(child: Conversation): Promise<void> {
    if (!this.options.onChildUsage) return;
    const receipts = await child.commit(async tx => {
      const ledger = await tx.doc(UsageDoc, child.id);
      const projected = await tx.doc(ChildUsageProjection, child.id);
      const entries: EntryRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries({ conversationId: child.id }, 64, cursor);
        entries.push(...page.items); cursor = page.next;
      } while (cursor !== undefined);
      for (const [key, total] of Object.entries(ledger.models)) {
        const previous = projected.models[key];
        const delta = JSON.parse(JSON.stringify(total)) as import("@earendil-works/pi-ai").Usage;
        for (const counter of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
          delta[counter] -= previous?.[counter] ?? 0;
          if (delta[counter] < 0) throw new Error("Native child usage counters moved backwards.");
        }
        for (const counter of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) delta.cost[counter] -= previous?.cost[counter] ?? 0;
        if (delta.input || delta.output || delta.cacheRead || delta.cacheWrite || delta.totalTokens || delta.cost.total) {
          const model = this.options.models.getModels().find(model => `${model.provider}/${model.id}` === key);
          if (!model) throw new Error("Native child usage model is unavailable.");
          entries.push(await tx.appendEntry(ChildUsageReceipt, child.id, { data: { provider: model.provider, model: model.id, api: model.api,
            usage: JSON.parse(JSON.stringify(delta)) as JsonValue } }));
        }
        projected.models[key] = JSON.parse(JSON.stringify(total));
      }
      return entries;
    }, BACKGROUND_CONTEXT);
    for (const entry of receipts) if (ChildUsageReceipt.is(entry) && !this.projectedChildUsage.has(entry.id)) {
      await this.options.onChildUsage({ id: `pi:${createHash("sha256").update(this.options.storagePath).digest("hex")}:child:${child.id}:usage:${entry.id}`, ...entry.data,
        usage: entry.data.usage as unknown as import("@earendil-works/pi-ai").Usage });
      this.projectedChildUsage.add(entry.id);
    }
  }

  private installChildExtensions(): void {
    if (!this.options.childTools) return;
    for (const readOnlyShell of [true, false]) {
      const name = readOnlyShell ? "molibot.child.inspect" : "molibot.child.worker";
      const registry = createPiToolRegistry({ ...this.options, extensionName: name,
        tools: this.options.childTools().filter(tool => !readOnlyShell || tool.name === "read" || tool.name === "bash"),
        beforeRequest: async (messages, _signal, api) => {
          if (!api) throw new Error("Child generation has no native identity.");
          await this.checkChildDeadline(api);
          this.childBudget(api, "model");
          this.options.beforeChildGeneration?.(`child:${api.conversationId}:generation:${api.taskId}`);
          const agent = await api.snapshot(AgentDoc, api.conversationId, BACKGROUND_CONTEXT);
          this.options.onChildTrace?.("model.call.before", { modelAttemptId: `pi:child:${api.conversationId}:generation:${api.taskId}`,
            parentFactId: `subagent_task:${this.childParents.get(api.conversationId)}`, provider: agent?.model?.provider, model: agent?.model?.modelId });
          return messages;
        },
        afterResponse: async (message, api) => {
          if (message.stopReason === "deferred") return;
          if (message.stopReason === "error") this.childBudget(api, "failure");
          this.options.onChildTrace?.("model.call.after", { modelAttemptId: `pi:child:${api.conversationId}:generation:${api.taskId}`,
            parentFactId: `subagent_task:${this.childParents.get(api.conversationId)}`, provider: message.provider, model: message.model,
            usage: message.usage, stopReason: message.stopReason });
        },
        beforeTool: async (call, _signal, api) => {
          if (!api) throw new Error("Child tool has no native identity.");
          await this.checkChildDeadline(api);
          if (readOnlyShell && call.name === "bash" && !isSafeReadOnlySubagentCommand(String(call.arguments.command ?? ""))) {
            return { kind: "deny", reason: "This subagent only allows read-only inspection commands." };
          }
          this.childBudget(api, "tool");
          this.options.beforeChildTool?.(`child:${api.conversationId}:tool:${api.taskId}`);
          this.options.onChildTrace?.("tool.call.before", { toolCallId: `pi:child:${api.conversationId}:tool:${api.taskId}`,
            toolName: call.name, parentFactId: `subagent_task:${this.childParents.get(api.conversationId)}`, argsPreview: JSON.stringify(call.arguments).slice(0, 500) });
          return { kind: "allow" };
        },
        afterTool: async (call, result, api) => {
          this.options.onChildTrace?.(result.isError ? "tool.call.error" : "tool.call.after", {
            toolCallId: `pi:child:${api.conversationId}:tool:${api.taskId}`, toolName: call.name,
            parentFactId: `subagent_task:${this.childParents.get(api.conversationId)}`, resultPreview: JSON.stringify(result.content).slice(0, 1000) });
          this.childBudget(api, "result", Boolean(result.isError));
          this.options.afterChildTool?.(`child:${api.conversationId}:tool:${api.taskId}`, Boolean(result.isError));
        },
        child: undefined,
        beforeCompact: async (_compaction, api) => {
          if (!this.options.childCompaction?.enabled) return { decline: true };
          await this.checkChildDeadline(api);
          this.childBudget(api, "model");
          this.options.beforeChildGeneration?.(`child:${api.conversationId}:compaction:${api.taskId}`);
          const agent = await api.snapshot(AgentDoc, api.conversationId, BACKGROUND_CONTEXT);
          this.options.onChildTrace?.("model.call.before", { modelAttemptId: `pi:child:${api.conversationId}:compaction:${api.taskId}`,
            parentFactId: `subagent_task:${this.childParents.get(api.conversationId)}`, provider: agent?.model?.provider, model: agent?.model?.modelId, purpose: "compaction" });
        },
        beforeExecute: api => this.checkChildDeadline(api),
        onRecoveryRequired: (cause, conversationId) => {
          const stop = conversationId === undefined ? undefined : this.childStops.get(conversationId);
          if (stop) stop(cause);
          else this.suspendFailure(cause);
        }
      }, (requestId, detail) => {
        void Promise.resolve(this.options.onSuspended?.(requestId, detail)).then(() => this.suspend(requestId), cause => this.suspendFailure(cause));
      });
      this.registryTools!.registry.install(registry.registry.snapshot().extension(name)!);
      this.childRegistries.push(registry);
    }
  }

  private async childSession(invocation: Pick<NativeInvocation, "api" | "context">, options: NativeChildOptions): Promise<NativeChildSession> {
    const { api, context } = invocation;
    this.options.assertStorageOwnership();
    for (const model of options.allowedModels ?? [options.model]) this.options.registerModel?.(model);
    const extension = this.registryTools!.registry.snapshot().extension(options.readOnlyShell ? "molibot.child.inspect" : "molibot.child.worker");
    if (!extension) throw new Error("Native child tools are unavailable.");
    const record = await api.commit(async tx => {
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries({ conversationId: api.conversationId }, 64, cursor);
        const existing = page.items.find(entry => ChildBinding.is(entry) && entry.data.taskId === api.taskId && entry.data.key === options.key);
        if (existing && ChildBinding.is(existing)) {
          if (existing.data.instructions !== options.instructions || JSON.stringify(existing.data.tools) !== JSON.stringify(options.tools)) {
            throw new Error("Native child admission changed during recovery.");
          }
          return existing;
        }
        cursor = page.next;
      } while (cursor !== undefined);
      const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
      const policy = await tx.doc(ChildPolicy, child.id);
      policy.deadlineAt = options.deadlineMs ? Date.now() + options.deadlineMs : 0;
      const tools = extension.tools?.filter(tool => options.tools.includes(tool.name)) ?? [];
      await configureAgent(tx, child.id, { model: { provider: options.model.provider, modelId: options.model.id },
        instructions: options.instructions, thinkingLevel: options.thinkingLevel, extensions: [extension], tools });
      const sanitizeModel = (model: import("@earendil-works/pi-ai").Model<any>) => {
        const { headers: _headers, ...safeModel } = model;
        return JSON.parse(JSON.stringify(safeModel)) as JsonValue;
      };
      return tx.appendEntry(ChildBinding, api.conversationId, { data: { taskId: api.taskId, key: options.key,
        conversationId: child.id, model: sanitizeModel(options.model), catalog: (options.allowedModels ?? [options.model]).map(sanitizeModel), instructions: options.instructions, tools: [...options.tools] } });
    }, context);
    this.childParents.set(record.data.conversationId, record.data.key);
    const child = await this.harness!.conversation(record.data.conversationId as ConversationId, context);
    if (!child) throw new Error("Native owned conversation is missing.");
    const catalog = record.data.catalog as unknown as import("@earendil-works/pi-ai").Model<any>[];
    const model = catalog.find(candidate => candidate.provider === options.model.provider && candidate.id === options.model.id
      && candidate.api === options.model.api && candidate.baseUrl === options.model.baseUrl);
    if (!model) throw new Error("Native child model differs from its admitted catalog.");
    const state: NativeChildSession["state"] = { messages: [] };
    const listeners = new Set<(event: import("@earendil-works/pi-agent-core").AgentEvent) => void>();
    const refresh = async () => {
      await this.projectChildUsage(child);
      state.messages = (await child.context(context)).entries.flatMap(entry => entry.model ?? []) as typeof state.messages;
      const ledger = await this.harness!.snapshot(UsageDoc, child.id, context);
      const usage: import("@earendil-works/pi-ai").Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      for (const item of [...Object.values(ledger?.models ?? {}), ...Object.values(ledger?.tools ?? {})]) {
        usage.input += item.input; usage.output += item.output; usage.cacheRead += item.cacheRead; usage.cacheWrite += item.cacheWrite; usage.totalTokens += item.totalTokens;
        usage.cost.input += item.cost.input; usage.cost.output += item.cost.output; usage.cost.cacheRead += item.cost.cacheRead; usage.cost.cacheWrite += item.cost.cacheWrite; usage.cost.total += item.cost.total;
      }
      state.usage = usage;
      if (this.options.childBudgetLimits) {
        const store = new RunBudgetStore(join(dirname(this.options.storagePath), "child-budgets.sqlite"), `${this.options.storagePath}:${child.id}`, this.options.childBudgetLimits);
        try { state.budget = new RunBudget(this.options.childBudgetLimits, store).snapshot(); } finally { store.close(); }
      }
    };
    await refresh();
    const watch = await watchEvents(this.harness!, child.id, context);
    const deferred = async (pollAt: number) => {
      this.deferredChildren.add(child.id);
      await this.options.onChildDeferred?.(pollAt);
    };
    if (watch.snapshot.generation?.deferred) await deferred(watch.snapshot.generation.deferred.pollAt);
    watch.start(async events => {
      for (const event of events) {
        await refresh();
        if (event.type === "compaction_end") {
          const task = await this.harness!.getTask(event.taskId, BACKGROUND_CONTEXT);
          this.options.onChildTrace?.("model.call.after", { modelAttemptId: `pi:child:${child.id}:compaction:${event.taskId}`,
            parentFactId: `subagent_task:${this.childParents.get(child.id)}`, purpose: "compaction", stopReason: task?.state.status === "terminal" && task.state.outcome.status === "completed" ? "stop" : "error" });
        }
        if (event.type === "deferred_poll") await deferred(event.pollAt);
        if (event.type === "message_start") {
          for (const listener of listeners) listener({ type: event.type, message: event.message });
        } else if (event.type === "message_end") {
          for (const message of event.entry.model ?? []) for (const listener of listeners) listener({ type: event.type, message });
        } else if (event.type === "tool_execution_start") {
          for (const listener of listeners) listener(event);
        } else if (event.type === "tool_execution_end" && event.entry) {
          const result = event.entry.model?.find(message => message.role === "toolResult");
          if (result) for (const listener of listeners) listener({ type: "tool_execution_end", toolCallId: event.toolCallId,
            toolName: event.toolName, isError: Boolean(result.isError), result: { content: result.content, ...decodePiToolDetails(result.details) } });
        }
      }
    });
    return { state, model, sessionId: `pi-child-${child.id}`,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      prompt: async text => {
        const policy = await this.harness!.snapshot(ChildPolicy, child.id, context);
        if (policy?.deadlineAt && Date.now() >= policy.deadlineAt) {
          await child.abort(BACKGROUND_CONTEXT, { background: true });
          throw new Error("Subagent exceeded its original time budget.");
        }
        const timer = policy?.deadlineAt ? setTimeout(() => { state.runtimeStop = { kind: "timeout", reason: "Subagent exceeded its original time budget." }; void child.abort(BACKGROUND_CONTEXT, { background: true }).catch(() => undefined); }, Math.max(0, policy.deadlineAt - Date.now())) : undefined;
        let settleStop!: () => void;
        const stopped = new Promise<void>(resolve => { settleStop = resolve; });
        this.childStops.set(child.id, cause => {
          state.runtimeStop = { kind: cause.message.includes("time budget") ? "timeout" : cause.message.startsWith("Run budget exceeded:") ? "budget_exceeded" : "execution_error", reason: cause.message };
          settleStop();
        });
        const readBudget = () => {
          if (!this.options.childBudgetLimits) return undefined;
          const store = new RunBudgetStore(join(dirname(this.options.storagePath), "child-budgets.sqlite"), `${this.options.storagePath}:${child.id}`, this.options.childBudgetLimits);
          try { return store.read(); } finally { store.close(); }
        };
        try {
          const execute = async () => {
            await this.checkChildDeadline({ ...api, conversationId: child.id });
            const submission = await child.submit({ type: "input", requestId: "task", content: text }, context);
            await submission.wait(context);
            await child.waitForIdle(context);
            await refresh();
            let lengthRetries = 0;
            while (!this.deferredChildren.has(child.id)) {
              context.abortSignal?.throwIfAborted();
              const last = [...state.messages].reverse().find(message => message.role === "assistant");
              if (last?.role !== "assistant") break;
              if (last.stopReason === "length") {
                // Output hit the token ceiling. Reasoning shares that budget, so
                // a model that truncated mid-thinking produced nothing usable;
                // drop thinking and continue the committed context rather than
                // reporting a bare, unexplained failure.
                const recovery = planLengthRecovery({
                  hasUsableOutput: assistantHasUsableOutput(last),
                  lengthRetries,
                  maxLengthRetries: MAX_LENGTH_RETRIES
                });
                if (recovery.action === "give_up") {
                  state.runtimeStop = { kind: "length_exceeded", reason: `Model output was truncated at the token limit and was not completed within ${MAX_LENGTH_RETRIES} retries.` };
                  break;
                }
                lengthRetries += 1;
                if (recovery.disableThinking) {
                  await child.configure({ thinkingLevel: "off" }, context);
                }
                const taskId = await this.continuationTask(child, `length-retry:${lengthRetries}:${last.timestamp}:${model.provider}:${model.id}`);
                await this.harness!.waitForTask(taskId, context);
                await child.waitForIdle(context);
                await refresh();
                continue;
              }
              if (last.stopReason !== "error") break;
              const budget = readBudget();
              const active = await child.agent(context);
              const changedModel = active.model?.provider !== model.provider || active.model.modelId !== model.id;
              if (!budget && !changedModel) break;
              if (budget?.exceededReason) {
                state.runtimeStop = { kind: "budget_exceeded", reason: budget.exceededReason };
                break;
              }
              if (changedModel) await child.configure({ model: { provider: model.provider, modelId: model.id } }, context);
              // Continue the committed child context; retrying never replays completed tools.
              const taskId = await this.continuationTask(child, `retry:${budget?.modelFailures ?? last.timestamp}:${model.provider}:${model.id}`);
              await this.harness!.waitForTask(taskId, context);
              await child.waitForIdle(context);
              await refresh();
            }
          };
          await Promise.race([execute(), stopped]);
          if (state.runtimeStop) {
            await child.abort(BACKGROUND_CONTEXT, { background: true });
            await child.waitForIdle(BACKGROUND_CONTEXT);
            await refresh();
          }
        } finally { this.childStops.delete(child.id); if (timer) clearTimeout(timer); }
      },
      abort: () => child.abort(context, { background: true }),
      dispose: async () => { const end = await watch.stop(); if (end.reason === "listener_error") throw end.error; }
    };
  }

  async configure(change: { model?: ModelRef; thinkingLevel?: AgentChange["thinkingLevel"]; instructions?: string; tools?: readonly string[] }): Promise<void> {
    if (this.closing) throw new Error("Pi conversation is closing.");
    const conversation = this.requireConversation();
    if (change.model && !(this.options.allowedModels ?? [this.options.model]).some(ref =>
      ref.provider === change.model!.provider && ref.modelId === change.model!.modelId)) throw new Error("Model is not authorized for this conversation.");
    const { tools, ...agentChange } = change;
    await conversation.configure({ ...agentChange, ...(tools ? { tools: this.visible(tools) } : {}) }, BACKGROUND_CONTEXT);
  }

  async submit(input: { requestId: string; content: UserInput; whenBusy?: "steer" | "followUp" | "reject" }) {
    if (this.closing) throw new Error("Pi conversation is closing.");
    const conversation = this.requireConversation();
    if (input.whenBusy === "steer" || input.whenBusy === "followUp") {
      await conversation.commit(async tx => {
        await tx.appendEntry(Control, conversation.id, { data: { requestId: input.requestId, mode: input.whenBusy as "steer" | "followUp" } });
      }, BACKGROUND_CONTEXT);
    }
    return conversation.submit({ type: "input", ...input }, BACKGROUND_CONTEXT);
  }

  get projectionRunId(): string | undefined { return this.originRunId; }
  get admittedInput(): UserInput | undefined { return this.admitted; }

  async runInput(onAdmitted?: () => Promise<void>) {
    const conversation = this.requireConversation();
    await this.assertRecovery();
    const submission = await conversation.submit({ type: "input", requestId: this.requestId, content: this.admitted! }, BACKGROUND_CONTEXT);
    await onAdmitted?.();
    return this.wait(async () => { await submission.wait(BACKGROUND_CONTEXT); await conversation.waitForIdle(BACKGROUND_CONTEXT); });
  }

  /** A native generation from committed context, with no synthetic user turn or transcript rollback. */
  async continue(requestId: string) {
    const conversation = this.requireConversation();
    await this.assertRecovery();
    const taskId = await this.continuationTask(conversation, requestId);
    return this.wait(async () => { await this.harness!.waitForTask(taskId, BACKGROUND_CONTEXT); await conversation.waitForIdle(BACKGROUND_CONTEXT); });
  }

  private async continuationTask(conversation: Conversation, requestId: string) {
    return conversation.commit(async tx => {
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries({ conversationId: conversation.id }, 64, cursor);
        const existing = page.items.find(entry => Continuation.is(entry) && entry.data.requestId === requestId);
        if (existing && Continuation.is(existing)) return existing.data.taskId;
        cursor = page.next;
      } while (cursor !== undefined);
      const live = await tx.doc(LiveDoc, conversation.id);
      if (live.run) throw new Error("Pi conversation is busy.");
      const taskId = await tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } });
      await tx.appendEntry(Continuation, conversation.id, { data: { requestId, taskId } });
      live.run = { taskId, inputs: [] };
      return taskId;
    }, BACKGROUND_CONTEXT);
  }

  async generationTaskId(): Promise<string | undefined> {
    const live = await this.harness!.snapshot(LiveDoc, this.conversation!.id, BACKGROUND_CONTEXT);
    return live?.run ? String(live.run.taskId) : undefined;
  }

  private async wait(work: () => Promise<void>) {
    const displayFailure = this.watch!.closed.then(end => {
      if (end.reason === "listener_error") throw end.error;
      return new Promise<never>(() => undefined);
    });
    void displayFailure.catch(() => undefined);
    const result = await Promise.race([work().then(() => ({ status: "idle" as const })),
      this.suspended.then(({ requestId }) => ({ status: "waiting_for_approval" as const, requestId })), displayFailure]);
    this.requireConversation();
    if (this.suspensionFailure) throw this.suspensionFailure;
    await this.serializeProjection(async () => this.project((await this.context()).entries));
    return result;
  }

  private async assertRecovery(): Promise<void> {
    const inspection = await this.harness!.inspect(BACKGROUND_CONTEXT);
    for (const { record } of inspection.tasks) {
      if (record.kind !== ToolTask.definition.name || !("checkpoint" in record.state)) continue;
      const checkpoint = record.state.checkpoint;
      if (checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) && checkpoint.phase === "execute") {
        const input = record.input;
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid persisted tool task.");
        const assistant = (await this.harness!.commit(tx => tx.entry(input.assistant as EntryId), BACKGROUND_CONTEXT))?.model?.[0];
        const call = assistant?.role === "assistant" ? assistant.content.find(block => block.type === "toolCall" && block.id === input.callId) : undefined;
        const tool = call?.type === "toolCall" ? [...this.registryTools!.tools, ...(this.options.childTools?.() ?? [])].find(tool => tool.name === call.name) : undefined;
        if (checkpoint.replay !== "safe" || tool?.replay !== "safe") throw new Error("External operation outcome is unknown; review it before continuing.");
      }
    }
  }

  private serializeProjection(work: () => Promise<void>): Promise<void> {
    this.projection = this.projection.then(work);
    return this.projection;
  }

  private async project(entries: readonly EntryRecord[]): Promise<void> {
    for (const entry of entries) if (entry.model?.length && !History.is(entry)) {
      this.options.assertStorageOwnership();
      let input: { primary: boolean; mode?: "steer" | "followUp" } | undefined;
      if (entry.model.some(message => message.role === "user")) {
        input = await this.inputIdentity(entry.id);
      }
      await this.options.projectEntry?.(entry, `pi:${this.key}:${entry.id}`, input);
    }
  }

  private async inputIdentity(entryId: EntryId): Promise<{ primary: boolean; mode?: "steer" | "followUp" }> {
    return this.conversation!.commit(async tx => {
      const primary = await tx.submissionByRequest(this.conversation!.id, this.requestId!);
      if (primary && "entry" in primary && primary.entry === entryId) return { primary: true };
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries({ conversationId: this.conversation!.id }, 64, cursor);
        for (const record of page.items) if (Control.is(record)) {
          const submission = await tx.submissionByRequest(this.conversation!.id, record.data.requestId);
          if (submission && "entry" in submission && submission.entry === entryId) return { primary: false, mode: record.data.mode };
        }
        cursor = page.next;
      } while (cursor !== undefined);
      return { primary: false };
    }, BACKGROUND_CONTEXT);
  }

  /** Commit the host's summary as a native context boundary without rewriting receipts. */
  async replaceContext(messages: readonly import("@earendil-works/pi-ai").Message[]): Promise<void> {
    this.options.assertStorageOwnership();
    await this.requireConversation().commit(tx => tx.appendEntry(History, this.conversation!.id,
      { head: "self", model: messages }), BACKGROUND_CONTEXT);
  }

  async compact(instructions?: string) {
    const task = await this.requireConversation().compact(instructions, BACKGROUND_CONTEXT);
    await this.harness!.waitForTask(task, BACKGROUND_CONTEXT);
    await this.serializeProjection(async () => this.project((await this.context()).entries));
  }

  async abort(): Promise<void> {
    const conversation = this.conversation;
    if (!conversation) return;
    this.aborting ??= conversation.abort(BACKGROUND_CONTEXT, { background: true });
    await this.aborting;
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      try { await this.opening; } catch { /* Initialization already cleaned up its resources. */ }
      await this.closeResources();
    })();
    return this.closing;
  }

  private async closeResources(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const harness = this.harness;
    try {
      try { if (this.watch) await this.watch.stop(); }
      finally { if (this.aborting) await this.aborting; }
    } finally {
      try {
        const results = await Promise.allSettled([...[this.registryTools, ...this.childRegistries].flatMap(registry => [...registry?.preparedCalls.values() ?? []])].map(async prepared => {
          if ("execute" in prepared) prepared.cancel();
        }));
        const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length) throw new AggregateError(failures, "Prepared tool cleanup failed.");
      } finally {
        try { if (harness) await harness.close(BACKGROUND_CONTEXT); }
        finally { this.harness = undefined; this.conversation = undefined; this.releaseStorage?.(); this.releaseStorage = undefined; }
      }
    }
  }
}
