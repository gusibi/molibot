import type { ToolRiskLevel } from "$lib/server/agent/tools/toolTypes.js";

export type ApprovalScope = "once" | "turn" | "session" | "workspace" | "persistent";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

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
