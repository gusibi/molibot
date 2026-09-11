import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from "$lib/server/agent/permissions/decidePermission.js";
import { resolveSessionScopedOverrideWithSource } from "$lib/server/agent/permissions/overrideResolver.js";
import type { ToolSandboxSettings } from "$lib/server/settings/index.js";

export type PermissionModeSource = "session" | "project" | "instance" | "agent" | "global";

export interface ResolvedPermissionMode {
  mode: PermissionMode;
  /** Which level of the override chain decided, so the UI can say "inherited from …". */
  source: PermissionModeSource;
}

/**
 * The effective permission mode for a run, resolved through the same five-level
 * chain every session-scoped setting uses: session → project → bot instance →
 * agent → global.
 *
 * Every transport receives the mode it resolved — Plan and Manual are honoured
 * on channels (Plan is read-only and needs no interaction surface; Manual's
 * approval suspends the run through the existing defer/`waiting_for_approval`
 * path and is resolved from wherever the owner actually is). There is no
 * clamping: clamping Manual to Accept Edits silently widened permissions on
 * transports without an approval card, which the unified-mode spec forbids.
 */
export function resolveEffectivePermissionMode(options: {
  getSettings: () => RuntimeSettings;
  chatId?: string;
  sessionId?: string;
  store?: MomRuntimeStore;
  channel?: string;
  botId?: string;
  agentId?: string;
  projectOverride?: PermissionMode;
}): ResolvedPermissionMode {
  const settings = options.getSettings();
  const resolved = resolveSessionScopedOverrideWithSource<PermissionMode>(
    settings,
    {
      chatId: options.chatId,
      sessionId: options.sessionId,
      channel: options.channel,
      botId: options.botId,
      agentId: options.agentId
    },
    {
      // Feature-detected rather than assumed: a store predating this field (an
      // older persisted runtime, or a caller's stub) has no session-level
      // opinion, which is "keep looking" — not a crash that would take down
      // every run through `createMomTools`.
      session: () =>
        options.store
          && options.chatId
          && options.sessionId
          && typeof options.store.getSessionPermissionModeOverride === "function"
          ? options.store.getSessionPermissionModeOverride(options.chatId, options.sessionId)
          : null,
      project: options.projectOverride,
      instance: (instance) => instance.permissionMode as PermissionMode | undefined,
      agent: (agent) => agent.permissionMode as PermissionMode | undefined,
      global: () => settings.permissionMode ?? DEFAULT_PERMISSION_MODE
    }
  );
  return { mode: resolved.value, source: resolved.source };
}

/**
 * Where commands run for the active attempt. The mode decides — there is no
 * separate sandbox-enabled switch left:
 *
 * - `auto` executes directly on the host (full access);
 * - `plan` executes nothing (read-only toolset);
 * - `manual` / `accept_edits` default to the sandbox, with host access gated by
 *   the mode's approval path.
 */
export type ExecutionTarget = "sandbox" | "host" | "none";

/**
 * The one effective execution policy for an attempt: the selected mode, where
 * it came from, the execution target it implies, and the sandbox restrictions
 * that apply (only when the sandbox actually participates). Tool dispatch,
 * shell execution, file access, approval decisions, subagent creation, the
 * system prompt and the UI all read this same result.
 */
export interface EffectiveExecutionPolicy {
  mode: PermissionMode;
  source: PermissionModeSource;
  executionTarget: ExecutionTarget;
  /** Present only when `executionTarget === "sandbox"`. */
  sandbox?: ToolSandboxSettings;
}

export function resolveEffectiveExecutionPolicy(options: {
  getSettings: () => RuntimeSettings;
  chatId?: string;
  sessionId?: string;
  store?: MomRuntimeStore;
  channel?: string;
  botId?: string;
  agentId?: string;
  projectOverride?: PermissionMode;
}): EffectiveExecutionPolicy {
  const settings = options.getSettings();
  const resolved = resolveEffectivePermissionMode(options);
  const executionTarget: ExecutionTarget =
    resolved.mode === "auto" ? "host"
    : resolved.mode === "plan" ? "none"
    : "sandbox";
  return {
    mode: resolved.mode,
    source: resolved.source,
    executionTarget,
    sandbox: executionTarget === "sandbox" ? settings.toolSandbox : undefined
  };
}
