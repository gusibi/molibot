import { DEFAULT_AGENT_ID, normalizeChannelAgentId, type RuntimeSettings } from "$lib/server/settings/schema.js";

/**
 * Channel/Profile binding to Agent.
 *
 * The four outcomes are deliberately distinct: an empty binding means Momo
 * (`default`), an unknown Bot means the conversation has no owner yet, and a
 * binding to a missing or deleted Agent must be rejected rather than silently
 * falling back. Collapsing them into one `|| "default"` is what let execution
 * identity drift between entry points.
 */
export type BotBinding =
  | { kind: "bound"; agentId: string }
  | { kind: "default"; agentId: typeof DEFAULT_AGENT_ID }
  | { kind: "unknown" }
  | { kind: "invalid"; agentId: string; reason: "missing" | "deleted" };

export type AdmissionMode = "new" | "pinned" | "recovery";
export type IdentitySource = "session" | "explicit" | "binding" | "default";

export interface ExecutionIdentity {
  agentId: string;
  mode: AdmissionMode;
  source: IdentitySource;
  /** Whether the caller keeps the current Session or creates a new one. */
  action: "reuse" | "create";
}

export interface ExecutionIdentityInput {
  /** Bot/Profile the request arrived through. Not required when an Agent is asserted. */
  channel?: string;
  botId?: string;
  /** Agent asserted by the caller. A mismatch with persisted ownership is rejected. */
  assertedAgentId?: string;
  /** Agent already resolved by the caller (channel binding, event target, or client selection). */
  targetAgentId?: string;
  /** Agent already persisted on the Session, if any. */
  persistedAgentId?: string;
  /** The request names an existing Session (reply, continuation) rather than a new chat. */
  explicitTarget?: boolean;
  /** The named Session already holds messages, so it cannot be adopted without a claim. */
  hasContext?: boolean;
  /** The request matches a suspended run and is a resume, not a new turn. */
  recoveryMatches?: boolean;
}

/** Reads the one channel binding that execution identity depends on. */
export function agentOfBot(settings: RuntimeSettings, channel: string, botId: string): BotBinding {
  const instance = settings.channels?.[channel]?.instances?.find(item => item.id === botId);
  if (!instance) return { kind: "unknown" };
  const raw = String(instance.agentId ?? "").trim();
  const agentId = raw ? normalizeChannelAgentId(raw) : DEFAULT_AGENT_ID;
  if (settings.deletedAgentIds?.includes(agentId)) return { kind: "invalid", agentId, reason: "deleted" };
  if (!settings.agents?.some(agent => agent.id === agentId)) return { kind: "invalid", agentId, reason: "missing" };
  return raw ? { kind: "bound", agentId } : { kind: "default", agentId: DEFAULT_AGENT_ID };
}

/** Display/prompt paths: the resolved Agent, or undefined when there is none. */
export function botAgentId(settings: RuntimeSettings, channel: string, botId: string): string | undefined {
  const binding = agentOfBot(settings, channel, botId);
  return binding.kind === "bound" || binding.kind === "default" ? binding.agentId : undefined;
}

/** Execution paths: the resolved Agent, or a rejection. */
export function requireBotAgentId(settings: RuntimeSettings, channel: string, botId: string): string {
  const binding = agentOfBot(settings, channel, botId);
  if (binding.kind === "bound" || binding.kind === "default") return binding.agentId;
  if (binding.kind === "unknown") throw new Error(`Unknown Bot: ${channel}/${botId}`);
  throw new Error(`Agent binding is invalid: ${channel}/${botId} -> ${binding.agentId} (${binding.reason})`);
}

/**
 * Every Bot whose normalized binding points at this Agent, including empty
 * bindings that normalize to `default`. Lifecycle checks use this instead of
 * re-reading bindings themselves.
 */
export function channelBindingsFor(settings: RuntimeSettings, agentId: string): Array<{ channel: string; instanceId: string }> {
  const target = String(agentId ?? "").trim();
  if (!target) return [];
  const result: Array<{ channel: string; instanceId: string }> = [];
  for (const [channel, group] of Object.entries(settings.channels ?? {})) {
    for (const instance of group?.instances ?? []) {
      const raw = String(instance.agentId ?? "").trim();
      if ((raw ? normalizeChannelAgentId(raw) : DEFAULT_AGENT_ID) === target) {
        result.push({ channel, instanceId: instance.id });
      }
    }
  }
  return result;
}

/**
 * The single admission decision: which Agent runs this request, and whether it
 * continues the existing Session, adopts it, or starts a new one.
 *
 * Enabled/deleted checks stay with the caller (`requireEnabledAgent`) so a
 * recovery can keep a disabled Agent alive without every path re-deriving what
 * recovery means.
 */
export function resolveExecutionIdentity(
  settings: RuntimeSettings,
  input: ExecutionIdentityInput
): ExecutionIdentity {
  const persisted = String(input.persistedAgentId ?? "").trim() || undefined;
  const asserted = String(input.assertedAgentId ?? "").trim() || undefined;

  if (input.recoveryMatches && persisted) {
    requireAgent(settings, persisted);
    return { agentId: persisted, mode: "recovery", source: "session", action: "reuse" };
  }

  if (persisted) {
    if (asserted && asserted !== persisted) throw new Error("Session Agent mismatch");
    if (input.explicitTarget) {
      requireAgent(settings, persisted);
      return { agentId: persisted, mode: "pinned", source: "session", action: "reuse" };
    }
    const target = targetFor(settings, input);
    if (target.agentId === persisted) {
      requireAgent(settings, persisted);
      return { agentId: persisted, mode: "pinned", source: "session", action: "reuse" };
    }
    return { agentId: target.agentId, mode: "new", source: target.source, action: "create" };
  }

  if (input.explicitTarget && input.hasContext) {
    throw new Error("Session is unassigned; claim it before continuing");
  }
  const target = targetFor(settings, input);
  return {
    agentId: target.agentId,
    mode: "new",
    source: target.source,
    action: input.explicitTarget ? "reuse" : "create"
  };
}

function requireAgent(settings: RuntimeSettings, agentId: string): void {
  if (settings.deletedAgentIds?.includes(agentId) || !settings.agents?.some(agent => agent.id === agentId)) {
    throw new Error(`Agent not found: ${agentId}`);
  }
}

function assertedTarget(settings: RuntimeSettings, asserted: string): { agentId: string; source: IdentitySource } {
  requireAgent(settings, asserted);
  return { agentId: asserted, source: "explicit" };
}

function targetFor(settings: RuntimeSettings, input: ExecutionIdentityInput): { agentId: string; source: IdentitySource } {
  const asserted = String(input.assertedAgentId ?? "").trim();
  if (asserted) return assertedTarget(settings, asserted);
  const target = String(input.targetAgentId ?? "").trim();
  if (target) {
    requireAgent(settings, target);
    return { agentId: target, source: "binding" };
  }
  return bindingTarget(settings, input);
}

function bindingTarget(settings: RuntimeSettings, input: ExecutionIdentityInput): { agentId: string; source: IdentitySource } {
  if (!input.channel || !input.botId) throw new Error("An Agent or a Bot binding is required");
  const binding = agentOfBot(settings, input.channel, input.botId);
  if (binding.kind === "bound") return { agentId: binding.agentId, source: "binding" };
  if (binding.kind === "default") return { agentId: binding.agentId, source: "default" };
  if (binding.kind === "unknown") throw new Error(`Unknown Bot: ${input.channel}/${input.botId}`);
  throw new Error(`Agent binding is invalid: ${input.channel}/${input.botId} -> ${binding.agentId} (${binding.reason})`);
}
