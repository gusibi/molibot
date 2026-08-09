import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";
import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";
import type { SideEffectClass } from "$lib/server/agent/durable/types.js";
import type { HostBashApprovalPrompt } from "$lib/server/hostBash/types.js";

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
  /** Ask the pi agent loop to stop after this tool batch. */
  terminate?: boolean;
}

export interface ToolPreflightOutcome {
  /** Stop the current agent turn without executing the tool handler. */
  terminate?: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ToolApprovalRequest {
  backend: "approval_broker" | "host_bash";
  requestId: string;
  prompt: HostBashApprovalPrompt;
  request?: ApprovalRequest;
}

export interface ToolApprovalConsumptionRequest {
  backend: "approval_broker" | "host_bash";
  actionKey: string;
  toolId: string;
  command?: string;
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
  signal?: AbortSignal;
  /** The originating agent tool-call id. Unique per call, unlike runId which is shared by every call in a run. */
  toolCallId?: string;
  /** Streaming progress callback from the agent loop; handlers that delegate to AgentTool.execute must pass it through. */
  onUpdate?: (update: any) => void;
  /**
   * Durable runs install this hook at the shared tool boundary. It runs after
   * approval and immediately before the handler, so an intent is durable
   * before any external side effect can start.
   */
  onSideEffectPreflight?: (effect: ToolSideEffect) => Promise<ToolPreflightOutcome | void>;
  /** Durable runs install this hook after the handler settles to persist a receipt. */
  onSideEffectReceipt?: (effect: ToolSideEffect, result: ToolResult) => Promise<void>;
  /** Durable runs use this to surface approval without blocking a hidden attempt. */
  onApprovalRequest?: (request: ToolApprovalRequest) => Promise<"defer" | "wait" | void>;
  /** Durable retries may consume an already approved, execution-scoped action exactly once. */
  consumeDurableApproval?: (request: ToolApprovalConsumptionRequest) => Promise<false | "once" | "session" | "persistent">;
}

export interface ToolSideEffect {
  toolId: string;
  toolCallId?: string;
  sideEffectClass: SideEffectClass;
  idempotencyKey: string;
  targetSummary: string;
  contentSummary: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: unknown;
  risk: ToolRiskLevel;
  source: ToolSource;
  /** Explicit recovery semantics. Omitted third-party tools are conservative. */
  sideEffectClass?: SideEffectClass;
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
