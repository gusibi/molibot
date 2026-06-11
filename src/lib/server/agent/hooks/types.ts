import type { RuntimeSettings } from "$lib/server/settings/index.js";

export type HookKind = "observe" | "transform" | "gate";

/**
 * Stages currently emitted by the runtime. Stages marked "(reserved)" are part
 * of the public contract but are not emitted yet — hooks subscribing to them
 * will receive no events until the runtime wires them up.
 */
export type HookStage =
  | "run.started"
  | "run.finished"
  | "model.call.before"
  | "model.call.after"
  | "assistant.message.stream" // (reserved)
  | "tool.call.before"
  | "tool.call.after"
  | "tool.call.error"
  | "tool.call.blocked"
  | "run.beforeStart"
  | "input.enrich.before"
  | "input.enrich.after"
  | "prompt.build.before" // (reserved)
  | "prompt.build.after"
  | "model.select.before"
  | "model.select.after"
  | "skill.selected"
  | "skill.loaded"
  | "approval.requested"
  | "approval.resolved" // (reserved)
  | "sandbox.prepare.before" // (reserved)
  | "sandbox.prepare.after" // (reserved)
  | "sandbox.prepare.error" // (reserved)
  | "subagent.run.before" // (reserved)
  | "subagent.run.after" // (reserved)
  | "subagent.task.before"
  | "subagent.task.after"
  | "context.persist.before" // (reserved)
  | "context.persist.after" // (reserved)
  | "runtime.notice";

export interface HookContext {
  runId: string;
  channel: string;
  botId?: string;
  chatId: string;
  sessionId: string;
  workspaceId?: string;
  actorId?: string;
  signal?: AbortSignal;
  span?: { id: string; parentId?: string };
}

/**
 * Known payload shapes for stages the runtime emits today. Every shape keeps
 * an open index signature so emitters can attach extra diagnostic fields
 * without breaking hook consumers.
 */
interface OpenPayload {
  [key: string]: unknown;
}

export interface RunLifecyclePayload extends OpenPayload {
  messageId?: string | number;
  textLength?: number;
  attachmentCount?: number;
  imageCount?: number;
  status?: string;
  stopReason?: string;
  durationMs?: number;
  errorMessage?: string;
}

export interface ModelCallPayload extends OpenPayload {
  modelAttemptId?: string;
  modelCallSeq?: number;
  provider?: string;
  model?: string;
  api?: string;
  usage?: unknown;
  stopReason?: string;
}

export interface ToolCallPayload extends OpenPayload {
  toolName: string;
  toolCallId: string;
  displayName?: string;
  label?: string;
  argsPreview?: string;
  resultPreview?: string;
  isError?: boolean;
  blockedBy?: string;
  reason?: string;
}

export interface InputEnrichPayload extends OpenPayload {
  text?: string;
  textLength?: number;
}

export interface PromptBuildPayload extends OpenPayload {
  systemPrompt: string;
}

export interface SkillPayload extends OpenPayload {
  name?: string;
  scope?: string;
  filePath?: string;
  reason?: string;
}

export interface SubagentTaskPayload extends OpenPayload {
  agent?: string;
  taskIndex?: number;
  stopReason?: string;
}

export interface RuntimeNoticePayload extends OpenPayload {
  code?: string;
  severity?: "info" | "warn" | "warning" | "error";
  message?: string;
}

export interface StagePayloadMap {
  "run.beforeStart": RunLifecyclePayload;
  "run.started": RunLifecyclePayload;
  "run.finished": RunLifecyclePayload;
  "model.call.before": ModelCallPayload;
  "model.call.after": ModelCallPayload;
  "model.select.before": ModelCallPayload;
  "model.select.after": ModelCallPayload;
  "tool.call.before": ToolCallPayload;
  "tool.call.after": ToolCallPayload;
  "tool.call.error": ToolCallPayload;
  "tool.call.blocked": ToolCallPayload;
  "input.enrich.before": InputEnrichPayload;
  "input.enrich.after": InputEnrichPayload;
  "prompt.build.after": PromptBuildPayload;
  "skill.selected": SkillPayload;
  "skill.loaded": SkillPayload;
  "subagent.task.before": SubagentTaskPayload;
  "subagent.task.after": SubagentTaskPayload;
  "runtime.notice": RuntimeNoticePayload;
}

export type StagePayload<S extends HookStage> = S extends keyof StagePayloadMap
  ? StagePayloadMap[S]
  : Record<string, unknown>;

export interface HookEvent<TPayload = unknown> {
  stage: HookStage;
  kind: HookKind;
  timestamp: string;
  context: HookContext;
  payload: TPayload;
}

export type GateDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string; code?: string };

export type HookResult<TPayload = unknown> =
  | void
  | { type: "continue" }
  | { type: "replace"; payload: TPayload }
  | GateDecision;

export interface RuntimeHook<TPayload = unknown> {
  id: string;
  name?: string;
  stages: HookStage[];
  kind: HookKind;
  priority?: number;
  critical?: boolean;
  timeoutMs?: number;
  includeSensitiveData?: boolean;
  /**
   * Gate hooks only: what happens when the hook throws or times out.
   * "closed" (default) denies the gated action; "open" allows it.
   */
  failMode?: "open" | "closed";
  handle(event: HookEvent<TPayload>): Promise<HookResult<TPayload>> | HookResult<TPayload>;
}

export interface HookPlugin {
  id: string;
  name: string;
  description?: string;
  init?(settings: RuntimeSettings): Promise<void> | void;
  getHooks(): RuntimeHook[];
  destroy?(): Promise<void> | void;
}

export interface HookError {
  hookId: string;
  stage: HookStage;
  error: Error;
  critical: boolean;
  timestamp: string;
}

export interface HookManager {
  register(hook: RuntimeHook): void;
  unregister(id: string): boolean;
  list(): RuntimeHook[];
  registerPlugin(plugin: HookPlugin): Promise<void>;
  unregisterPlugin(id: string): Promise<boolean>;
  emit<S extends HookStage>(stage: S, context: HookContext, payload: StagePayload<S>): void;
  flush(options?: { timeoutMs?: number; runId?: string }): Promise<void>;
  transform<S extends HookStage>(stage: S, context: HookContext, payload: StagePayload<S>): Promise<StagePayload<S>>;
  gate<S extends HookStage>(stage: S, context: HookContext, payload: StagePayload<S>): Promise<GateDecision>;
}

/** Shared no-op manager for contexts that run without hooks. */
export const NOOP_HOOK_MANAGER: HookManager = {
  register: () => {},
  unregister: () => false,
  list: () => [],
  registerPlugin: async () => {},
  unregisterPlugin: async () => false,
  emit: () => {},
  flush: async () => {},
  transform: async (_stage, _context, payload) => payload,
  gate: async () => ({ type: "allow" })
};
