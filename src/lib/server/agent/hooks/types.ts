import type { RuntimeSettings } from "$lib/server/settings/index.js";

export type HookKind = "observe" | "transform" | "gate";

export type HookStage =
  | "run.started"
  | "run.finished"
  | "model.call.before"
  | "model.call.after"
  | "assistant.message.stream"
  | "tool.call.before"
  | "tool.call.after"
  | "tool.call.error"
  | "tool.call.blocked"
  | "run.beforeStart"
  | "input.enrich.before"
  | "input.enrich.after"
  | "prompt.build.before"
  | "prompt.build.after"
  | "model.select.before"
  | "model.select.after"
  | "skill.selected"
  | "skill.loaded"
  | "approval.requested"
  | "approval.resolved"
  | "sandbox.prepare.before"
  | "sandbox.prepare.after"
  | "sandbox.prepare.error"
  | "subagent.run.before"
  | "subagent.run.after"
  | "subagent.task.before"
  | "subagent.task.after"
  | "context.persist.before"
  | "context.persist.after"
  | "runtime.notice";

export interface HookContext {
  runId: string;
  channel: string;
  chatId: string;
  sessionId: string;
  workspaceId?: string;
  actorId?: string;
  signal?: AbortSignal;
  span?: { id: string; parentId?: string };
}

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
  emit<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): void;
  flush(options?: { timeoutMs?: number }): Promise<void>;
  transform<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): Promise<TPayload>;
  gate<TPayload>(stage: HookStage, context: HookContext, payload: TPayload): Promise<GateDecision>;
}
