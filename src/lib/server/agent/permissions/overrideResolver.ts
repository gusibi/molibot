import type { RuntimeSettings } from "$lib/server/settings/index.js";

/**
 * The one session-scoped override chain, shared by every setting that has one.
 *
 * Sandbox and permission mode resolve through exactly the same five levels, and
 * a second hand-written copy of that precedence would drift the first time
 * someone fixed a bug in one of them (CLAUDE.md pitfall 7). So the chain lives
 * here once and each setting supplies only its own lookups.
 *
 * Precedence, most specific first:
 *
 *   1. session      — this conversation only
 *   2. project      — the Project the run belongs to
 *   3. bot instance — this channel instance
 *   4. agent        — the agent the instance runs
 *   5. global       — the installation default
 *
 * `undefined`/`null` at a level means "not set here, keep looking"; it never
 * means "off". That distinction is what lets a session sit on the global
 * default and follow it when it changes, instead of silently pinning whatever
 * the default happened to be when the session started.
 */
export interface SessionScopeIdentity {
  chatId?: string;
  sessionId?: string;
  channel?: string;
  botId?: string;
  agentId?: string;
}

export interface OverrideChainLookups<T> {
  /** Level 1. */
  session?: () => T | null | undefined;
  /** Level 2. Already resolved by the caller, which knows the Project. */
  project?: T | null | undefined;
  /** Level 3. Receives the resolved instance record, if any. */
  instance?: (instance: ChannelInstanceLike) => T | null | undefined;
  /** Level 4. Receives the resolved agent record, if any. */
  agent?: (agent: AgentLike) => T | null | undefined;
  /** Level 5. Always defined — the chain must terminate. */
  global: () => T;
}

interface ChannelInstanceLike {
  id: string;
  agentId?: string;
  [key: string]: unknown;
}

interface AgentLike {
  id: string;
  [key: string]: unknown;
}

/**
 * Resolves the instance and agent records once, so a caller with several
 * settings to resolve does not walk `settings.channels` repeatedly.
 */
export function resolveScopeRecords(
  settings: RuntimeSettings,
  identity: SessionScopeIdentity
): { instance?: ChannelInstanceLike; agent?: AgentLike } {
  const { channel, botId } = identity;
  const instances = (channel ? settings.channels[channel]?.instances : undefined) ?? [];
  const instance = channel && botId
    ? (instances.find((item) => item.id === botId) as ChannelInstanceLike | undefined)
    : undefined;

  // An explicit agentId wins; otherwise inherit the instance's agent, which is
  // what makes an agent-level setting apply to the bots that run it.
  const agentId = identity.agentId ?? instance?.agentId;
  const agent = agentId
    ? (settings.agents.find((item) => item.id === agentId) as AgentLike | undefined)
    : undefined;

  return { instance, agent };
}

export function resolveSessionScopedOverride<T>(
  settings: RuntimeSettings,
  identity: SessionScopeIdentity,
  lookups: OverrideChainLookups<T>
): T {
  const sessionValue = lookups.session?.();
  if (sessionValue !== undefined && sessionValue !== null) return sessionValue;

  if (lookups.project !== undefined && lookups.project !== null) return lookups.project;

  const { instance, agent } = resolveScopeRecords(settings, identity);

  if (instance && lookups.instance) {
    const value = lookups.instance(instance);
    if (value !== undefined && value !== null) return value;
  }

  if (agent && lookups.agent) {
    const value = lookups.agent(agent);
    if (value !== undefined && value !== null) return value;
  }

  return lookups.global();
}
