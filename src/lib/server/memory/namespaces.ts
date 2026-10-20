import type { MemoryAccessScope, MemoryDomain, MemoryNamespace, MemoryScope } from "$lib/server/memory/types.js";

const DEFAULT_OWNER_ID = "owner";

function segment(value: string | undefined, fallback: string): string {
  return encodeURIComponent(String(value ?? "").trim() || fallback);
}

export function ownerNamespace(ownerId = DEFAULT_OWNER_ID): MemoryNamespace {
  return `owner:${segment(ownerId, DEFAULT_OWNER_ID)}`;
}

export function chatNamespace(scope: MemoryScope): MemoryNamespace {
  return `chat:${segment(scope.botId, "default")}:${segment(scope.channel, "unknown")}:${segment(scope.externalUserId, "unknown")}`;
}

export function projectNamespace(scope: MemoryScope): MemoryNamespace | undefined {
  return scope.projectId
    ? `project:${segment(scope.ownerId, DEFAULT_OWNER_ID)}:${segment(scope.projectId, "project")}`
    : undefined;
}

export function agentNamespace(botId?: string): MemoryNamespace {
  return `agent:${segment(botId, "default")}`;
}

export function contentNamespace(botId?: string): MemoryNamespace {
  return `content:${segment(botId, "default")}`;
}

function requireAgentId(scope: MemoryScope, reason: string): string {
  const agentId = String(scope.agentId ?? "").trim();
  if (!agentId) throw new Error(`Agent-scoped memory requires an Agent identity (${reason}).`);
  return agentId;
}

export function namespaceForDomain(scope: MemoryScope, domain: MemoryDomain): MemoryNamespace {
  if (domain === "owner") return ownerNamespace(scope.ownerId);
  if (domain === "project") {
    const project = projectNamespace(scope);
    if (!project) throw new Error("Project memory requires projectId.");
    return project;
  }
  if (domain === "agent_self") return agentNamespace(requireAgentId(scope, "agent_self"));
  return contentNamespace(scope.botId);
}

export function promptMemoryNamespaces(scope: MemoryScope): MemoryNamespace[] {
  const result: MemoryNamespace[] = [];
  if (scope.shareOwner !== false) result.push(ownerNamespace(scope.ownerId));
  result.push(chatNamespace(scope));
  // A Bot is not an Agent: without an Agent identity this scope has no
  // `agent:` namespace at all, rather than sharing one named after the Bot.
  if (String(scope.agentId ?? "").trim()) result.push(agentNamespace(scope.agentId));
  const project = projectNamespace(scope);
  if (project) result.push(project);
  return result;
}

export function deriveMemoryAccessScope(scope: MemoryScope, options: { includeContent?: boolean } = {}): MemoryAccessScope {
  const authorizedNamespaces = promptMemoryNamespaces(scope);
  if (options.includeContent) authorizedNamespaces.push(contentNamespace(scope.botId));
  return { ...scope, authorizedNamespaces: [...new Set(authorizedNamespaces)] };
}
