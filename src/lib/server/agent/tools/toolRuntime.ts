import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalRequest, ApprovalGrant } from "$lib/server/approval/approvalTypes.js";
import type {
  PolicyDecision,
  ToolCallInput,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult
} from "$lib/server/agent/tools/toolTypes.js";
import { getWorkspaceStore, type WorkspaceStore } from "$lib/server/workspaces/store.js";
import { buildHostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import type { HostBashApprovalRecord } from "$lib/server/hostBash/index.js";
import { pollUntilResolved } from "$lib/server/approval/approvalWaiter.js";

/**
 * Build the Host-Bash-shaped approval record the ApprovalBroker path reuses to
 * render an approval card for a non-bash high-risk tool. Both the pending-card
 * and the rejected/expired-result sites previously hand-built this same envelope
 * (channel "", ephemeral mode, scratch-only permissions, fields derived from the
 * request). Consolidated here with zero behavior change as part of the
 * approval-convergence Phase 1 (one prompt construction site instead of two).
 */
export function buildBrokerApprovalRecord(input: {
  request: ApprovalRequest;
  actorId: string;
  toolId: string;
  displayName: string;
  command: string;
  status: HostBashApprovalRecord["status"];
  pendingAction?: HostBashApprovalRecord["pendingAction"];
}): HostBashApprovalRecord {
  return {
    id: input.request.id,
    toolId: input.toolId,
    displayName: input.displayName,
    command: input.command,
    reason: input.request.reason,
    channel: "",
    chatId: input.actorId,
    scopeId: input.request.runId,
    sessionId: input.request.sessionId,
    approvalMode: "ephemeral",
    status: input.status,
    permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
    pendingAction: input.pendingAction,
    requestedAt: input.request.createdAt
  };
}

export type ToolPolicyDecider = (tool: ToolDefinition, input: unknown, ctx: ToolExecutionContext) => PolicyDecision;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
  }

  get(id: string): ToolDefinition | null {
    return this.tools.get(id) ?? null;
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}

interface DebounceBatch {
  requestId: string;
  capability: string;
  requests: ApprovalRequest[];
  resolvers: Array<(decision: "approved" | "rejected" | "expired") => void>;
  timer: NodeJS.Timeout;
}

const activeDebounceBatches = new Map<string, DebounceBatch>();

export class ToolRuntime {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: {
      approvalBroker?: ApprovalBroker;
      decidePolicy?: ToolPolicyDecider;
      workspaceStore?: WorkspaceStore;
    } = {}
  ) {}

  async executeToolCall(call: ToolCallInput): Promise<ToolResult> {
    const workspaceId = call.context.workspaceId;
    if (workspaceId) {
      const workspace = (this.options.workspaceStore ?? getWorkspaceStore()).getWorkspace(workspaceId);
      if (workspace) {
        const whitelisted = workspace.enabledToolIds;
        if (whitelisted.length > 0 && !whitelisted.includes("*") && !whitelisted.includes(call.toolId)) {
          return { ok: false, error: "Tool execution is rejected by workspace security policy." };
        }
      }
    }

    const tool = this.registry.get(call.toolId);
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${call.toolId}` };
    }

    const decision = (this.options.decidePolicy ?? defaultPolicyDecider)(tool, call.input, call.context);
    if (decision.type === "deny") {
      return { ok: false, error: decision.reason };
    }

    if (decision.type === "approval_required") {
      const grant = this.options.approvalBroker?.checkGrant({
        capability: decision.request.capability,
        actorId: decision.request.actorId,
        workspaceId: decision.request.workspaceId,
        sessionId: decision.request.sessionId,
        runId: decision.request.runId,
        actionFingerprint: decision.request.actionFingerprint
      });

      if (!grant) {
        let resolution: "approved" | "rejected" | "expired";
        const isHighRisk = tool.risk === "high" || tool.risk === "critical";

        if (isHighRisk) {
          this.options.approvalBroker?.createRequest(decision.request);
          resolution = await this.pollApprovalRequest(decision.request, call.context);
        } else {
          // Low/medium risk debounce aggregation (1.5 seconds)
          const batchKey = `${decision.request.sessionId}::${decision.request.capability}`;
          let batch = activeDebounceBatches.get(batchKey);

          if (!batch) {
            batch = {
              requestId: `${decision.request.runId}-debounce-${decision.request.capability}-${Date.now()}`,
              capability: decision.request.capability,
              requests: [],
              resolvers: [],
              timer: null as any
            };
            activeDebounceBatches.set(batchKey, batch);

            const currentBatch = batch;
            batch.timer = setTimeout(() => {
              activeDebounceBatches.delete(batchKey);
              const consolidatedReason = `Aggregated approval request for ${tool.name} and related tools.`;
              const consolidatedRequest: ApprovalRequest = {
                ...decision.request,
                id: currentBatch.requestId,
                reason: consolidatedReason,
                action: {
                  type: decision.request.action.type,
                  toolName: `${decision.request.action.toolName} (x${currentBatch.requests.length} aggregated)`
                },
                actionFingerprint: JSON.stringify({
                  fingerprints: currentBatch.requests.map((r) => r.actionFingerprint)
                })
              };

              this.options.approvalBroker?.createRequest(consolidatedRequest);

              void (async () => {
                const res = await this.pollApprovalRequest(consolidatedRequest, call.context);
                for (const resolve of currentBatch.resolvers) {
                  resolve(res);
                }
              })();
            }, 1500);
          }

          batch.requests.push(decision.request);
          resolution = await new Promise<"approved" | "rejected" | "expired">((resolve) => {
            batch!.resolvers.push(resolve);
          });
        }

        if (resolution === "approved") {
          // Approved! Fall through to tool handler execution.
        } else {
          const status = resolution === "rejected" ? "rejected" : "expired";
          const errorMsg = resolution === "rejected"
            ? "Tool execution is rejected by user approval."
            : "Tool execution is rejected: User approval timeout.";
          return {
            ok: false,
            error: errorMsg,
            metadata: {
              approvalRequestId: decision.request.id,
              status: "waiting_for_approval"
            },
            details: {
              hostBashApproval: buildHostBashApprovalPrompt(buildBrokerApprovalRecord({
                request: decision.request,
                actorId: call.context.actorId,
                toolId: tool.id,
                displayName: tool.name,
                command: decision.request.action.command ?? decision.request.action.path ?? tool.name,
                status: status === "expired" ? "failed" : status
              }))
            }
          };
        }
      }
    }

    call.context.emit({
      timestamp: new Date().toISOString(),
      workspaceId: call.context.workspaceId,
      type: "tool_start",
      toolName: tool.id,
      displayName: tool.name,
      summary: `Tool started: ${tool.name}`
    });

    const result = await tool.handler(call.input, call.context);
    call.context.emit({
      timestamp: new Date().toISOString(),
      workspaceId: call.context.workspaceId,
      type: "tool_end",
      toolName: tool.id,
      displayName: tool.name,
      summary: result.ok ? `Tool finished: ${tool.name}` : result.error ?? `Tool failed: ${tool.name}`,
      isError: !result.ok
    });
    return result;
  }

  private async pollApprovalRequest(
    request: ApprovalRequest,
    context: ToolExecutionContext
  ): Promise<"approved" | "rejected" | "expired"> {
    // Emit runner event with hostBashApproval to trigger client approval cards immediately
    context.emit({
      timestamp: new Date().toISOString(),
      workspaceId: context.workspaceId,
      type: "tool_end",
      toolName: request.action.toolName || "tool",
      displayName: request.action.toolName || "tool",
      summary: `Waiting for user approval: ${request.reason}`,
      hostBashApproval: buildHostBashApprovalPrompt(buildBrokerApprovalRecord({
        request,
        actorId: context.actorId,
        toolId: request.action.toolName || "tool",
        displayName: request.action.toolName || "tool",
        command: request.action.command ?? request.action.path ?? request.action.toolName ?? "tool",
        status: "pending",
        pendingAction: {
          kind: "run_one_time_host_script",
          originalCommand: request.action.command ?? request.action.path ?? request.action.toolName ?? "tool",
          args: [],
          timeout: 300
        }
      }))
    } as any);

    return pollUntilResolved<"approved" | "rejected" | "expired">({
      timeoutMs: 5 * 60 * 1000, // 5 minutes timeout
      pollMs: 500,
      signal: context.signal,
      poll: () => {
        const req = this.options.approvalBroker?.getRequest(request.id);
        if (req?.status === "approved") return { done: true, value: "approved" };
        if (req?.status === "rejected") return { done: true, value: "rejected" };
        if (req?.status === "expired") return { done: true, value: "expired" };
        return { done: false };
      },
      onAbort: () => "expired",
      onTimeout: () => {
        // Mark as expired in DB/broker
        const req = this.options.approvalBroker?.getRequest(request.id);
        if (req && req.status === "pending") {
          this.options.approvalBroker?.updateRequest({
            ...req,
            status: "expired" as const,
            resolvedAt: new Date().toISOString()
          });
        }
        return "expired";
      }
    });
  }
}

export function defaultPolicyDecider(tool: ToolDefinition, input: unknown, ctx: ToolExecutionContext): PolicyDecision {
  if (tool.risk === "high" || tool.risk === "critical") {
    return {
      type: "approval_required",
      request: createDefaultApprovalRequest(tool, input, ctx)
    };
  }
  return { type: "allow" };
}

export function createDefaultApprovalRequest(
  tool: ToolDefinition,
  input: unknown,
  ctx: ToolExecutionContext
): ApprovalRequest {
  const now = new Date().toISOString();
  const params = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const command = typeof params.command === "string" ? params.command.slice(0, 4000) : undefined;
  const path = typeof params.file_path === "string"
    ? params.file_path
    : typeof params.path === "string" ? params.path : undefined;
  return {
    id: `${ctx.runId}-${tool.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    workspaceId: ctx.workspaceId,
    actorId: ctx.actorId,
    capability: tool.source === "host" ? `bash:${tool.id}` : `${tool.source}:${tool.id}`,
    riskLevel: tool.risk,
    action: {
      type: tool.source === "mcp" ? "mcp_tool" : tool.source === "host" ? "bash" : "file_write",
      toolName: tool.id,
      command,
      path
    },
    reason: `Tool ${tool.name} is marked ${tool.risk} risk.`,
    status: "pending",
    requestedBy: {
      agentId: ctx.actorId,
      depth: 0
    },
    scopeOptions: ["once", "turn", "session"],
    actionFingerprint: JSON.stringify({ toolId: tool.id, input }),
    createdAt: now
  };
}
