import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";
import type {
  PolicyDecision,
  ToolCallInput,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult
} from "$lib/server/agent/tools/toolTypes.js";

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

export class ToolRuntime {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: {
      approvalBroker?: ApprovalBroker;
      decidePolicy?: ToolPolicyDecider;
    } = {}
  ) {}

  async executeToolCall(call: ToolCallInput): Promise<ToolResult> {
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
        this.options.approvalBroker?.createRequest(decision.request);
        return {
          ok: false,
          error: "Tool execution is waiting for approval.",
          metadata: {
            approvalRequestId: decision.request.id,
            status: "waiting_for_approval"
          }
        };
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
  return {
    id: `${ctx.runId}-${tool.id}`,
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    workspaceId: ctx.workspaceId,
    actorId: ctx.actorId,
    capability: `${tool.source}:${tool.id}`,
    riskLevel: tool.risk,
    action: {
      type: tool.source === "mcp" ? "mcp_tool" : tool.source === "host" ? "bash" : "file_write",
      toolName: tool.id
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
