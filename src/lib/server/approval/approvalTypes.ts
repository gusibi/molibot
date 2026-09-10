import type { ToolRiskLevel } from "$lib/server/agent/tools/toolTypes.js";

export type ApprovalScope = "once" | "turn" | "session" | "workspace" | "persistent";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

/**
 * How long a pending approval request stays answerable. Both approval backends
 * (the shared broker and Host Bash) expire unanswered requests after this long
 * on their read paths — a card older than the TTL shows the real expired state
 * instead of an action that can never be approved again. One constant because
 * the two backends previously drifted (issue #48).
 */
export const PENDING_APPROVAL_TTL_MS = 60 * 60 * 1000;

export interface ApprovalGrant {
  id: string;
  scope: ApprovalScope;
  capability: string;
  actorId: string;
  workspaceId?: string;
  sessionId?: string;
  runId?: string;
  actionFingerprint?: string;
  expiresAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  sessionId: string;
  workspaceId: string;
  actorId: string;
  capability: string;
  riskLevel: ToolRiskLevel;
  action: {
    type: "bash" | "file_read" | "file_write" | "network" | "mcp_tool" | "secret_access";
    command?: string;
    path?: string;
    domain?: string;
    toolName?: string;
    payload?: {
      path?: string;
      diff?: string;
      parameters?: Record<string, unknown>;
    };
  };
  reason: string;
  status: ApprovalStatus;
  requestedBy: {
    agentId: string;
    parentAgentId?: string;
    depth: number;
  };
  scopeOptions: ApprovalScope[];
  selectedScope?: ApprovalScope;
  actionFingerprint?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ApprovalMatchContext {
  capability: string;
  actorId: string;
  workspaceId: string;
  sessionId: string;
  runId: string;
  actionFingerprint?: string;
  now?: Date;
}
