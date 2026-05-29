import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";
import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";
export type ToolSource = "builtin" | "mcp" | "plugin" | "host" | "skill_script";

export interface SafeFsApi {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBuffer?(path: string): Promise<Buffer>;
}

export interface SafeShellApi {
  run(command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    sandboxApplied?: boolean;
    warning?: string;
  }>;
}

export interface SafeNetworkApi {
  fetch(input: string, init?: unknown): Promise<unknown>;
}

export interface ToolResult {
  ok: boolean;
  content?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
  details?: Record<string, any>;
}

export interface ToolExecutionContext {
  runId: string;
  sessionId: string;
  workspaceId: string;
  actorId: string;
  cwd: string;
  fs: SafeFsApi;
  shell: SafeShellApi;
  network: SafeNetworkApi;
  emit: (event: RunDetailEntry) => void;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: unknown;
  risk: ToolRiskLevel;
  source: ToolSource;
  requiredPermissions?: string[];
  handler: (input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult>;
}

export type PolicyDecision =
  | { type: "allow" }
  | { type: "sandbox" }
  | { type: "approval_required"; request: ApprovalRequest }
  | { type: "deny"; reason: string };

export interface ToolCallInput {
  toolId: string;
  input: unknown;
  context: ToolExecutionContext;
}
