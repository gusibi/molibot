import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalRequest, ApprovalGrant } from "$lib/server/approval/approvalTypes.js";
import type {
  PolicyDecision,
  ToolCallInput,
  ToolDefinition,
  ToolExecutionContext,
  ToolPreflightOutcome,
  ToolResult
} from "$lib/server/agent/tools/toolTypes.js";
import { getWorkspaceStore, type WorkspaceStore } from "$lib/server/workspaces/store.js";
import { buildHostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import type { HostBashApprovalRecord } from "$lib/server/hostBash/index.js";
import { BrokerApprovalService, type ApprovalService } from "$lib/server/approval/approvalService.js";
import { classifyToolSideEffect } from "$lib/server/agent/tools/sideEffectClassification.js";

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
  private readonly approvalService?: ApprovalService;
  private sideEffectTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: {
      approvalBroker?: ApprovalBroker;
      approvalService?: ApprovalService;
      decidePolicy?: ToolPolicyDecider;
      workspaceStore?: WorkspaceStore;
      /** Hard upper bound for one handler promise. Process-backed tools are also killed through the derived signal. */
      executionTimeoutMs?: number;
    } = {}
  ) {
    // Phase 2 façade: talk to the unified ApprovalService. Existing callers keep
    // passing `approvalBroker`; it is wrapped in the broker-backed adapter so
    // behavior is unchanged.
    this.approvalService = options.approvalService
      ?? (options.approvalBroker ? new BrokerApprovalService(options.approvalBroker) : undefined);
  }

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
      const grant = this.approvalService?.checkGrant({
        capability: decision.request.capability,
        actorId: decision.request.actorId,
        workspaceId: decision.request.workspaceId,
        sessionId: decision.request.sessionId,
        runId: decision.request.runId,
        actionFingerprint: decision.request.actionFingerprint
      });

      const durableApprovalScope = !grant
        ? await call.context.consumeDurableApproval?.({
            backend: "approval_broker",
            actionKey: [
              tool.id,
              decision.request.action.command ?? decision.request.action.path ?? tool.name,
              "ephemeral"
            ].join(":"),
            toolId: tool.id,
            command: decision.request.action.command ?? decision.request.action.path ?? tool.name
          })
        : false;

      if (!grant && !durableApprovalScope) {
        let resolution: "approved" | "rejected" | "expired";
        const isHighRisk = tool.risk === "high" || tool.risk === "critical";

        if (isHighRisk) {
          this.approvalService?.createRequest(decision.request);
          const approvalPrompt = buildHostBashApprovalPrompt(buildBrokerApprovalRecord({
            request: decision.request,
            actorId: call.context.actorId,
            toolId: tool.id,
            displayName: tool.name,
            command: decision.request.action.command ?? decision.request.action.path ?? tool.name,
            status: "pending"
          }));
          const approvalDisposition = await call.context.onApprovalRequest?.({
            backend: "approval_broker",
            requestId: decision.request.id,
            prompt: approvalPrompt,
            request: decision.request
          });
          if (approvalDisposition === "defer") {
            return {
              ok: false,
              error: "Tool execution is waiting for user approval.",
              metadata: {
                approvalRequestId: decision.request.id,
                status: "waiting_for_approval"
              },
              details: { hostBashApproval: approvalPrompt },
              terminate: true
            };
          }
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

              this.approvalService?.createRequest(consolidatedRequest);

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

    const sideEffect = classifyToolSideEffect(tool.id, call.input, call.context.toolCallId, tool.sideEffectClass);
    const hasSideEffectBoundary = sideEffect.sideEffectClass !== "pure";
    const releaseSideEffectSlot = hasSideEffectBoundary
      ? await this.acquireSideEffectSlot()
      : undefined;
    try {
      let preflight: ToolPreflightOutcome | void = undefined;
      if (hasSideEffectBoundary) {
        preflight = await call.context.onSideEffectPreflight?.(sideEffect);
      }
      if (preflight?.terminate) {
        return {
          ok: false,
          error: preflight.reason ?? `Tool ${tool.id} was stopped before execution.`,
          details: {
            ...(preflight.details ?? {}),
            durablePromotion: true
          },
          terminate: true
        };
      }

    call.context.emit({
      timestamp: new Date().toISOString(),
      workspaceId: call.context.workspaceId,
      type: "tool_start",
      toolName: tool.id,
      displayName: tool.name,
      summary: `Tool started: ${tool.name}`
    });

    const timeoutMs = Math.max(1, this.options.executionTimeoutMs ?? 5 * 60 * 1000);
    const timeoutController = new AbortController();
    const executionSignal = call.context.signal
      ? AbortSignal.any([call.context.signal, timeoutController.signal])
      : timeoutController.signal;
    const executionContext: ToolExecutionContext = { ...call.context, signal: executionSignal };
    let timer: NodeJS.Timeout | undefined;
    let cleanupAbort: (() => void) | undefined;
    const handler = tool.handler(call.input, executionContext).then(
      (value) => ({ type: "result" as const, value }),
      (error) => ({ type: "error" as const, error })
    );
    const deadline = new Promise<{ type: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        timeoutController.abort(new Error(`Tool ${tool.id} timed out after ${timeoutMs}ms.`));
        resolve({ type: "timeout" });
      }, timeoutMs);
    });
    const aborted = new Promise<{ type: "aborted" }>((resolve) => {
      const upstream = call.context.signal;
      if (!upstream) return;
      const onAbort = () => resolve({ type: "aborted" });
      if (upstream.aborted) onAbort();
      else {
        upstream.addEventListener("abort", onAbort, { once: true });
        cleanupAbort = () => upstream.removeEventListener("abort", onAbort);
      }
    });
    const settled = await Promise.race([handler, deadline, aborted]);
    if (timer) clearTimeout(timer);
    cleanupAbort?.();
    let result: ToolResult;
    if (settled.type === "result") {
      result = settled.value;
    } else if (settled.type === "error") {
      if (hasSideEffectBoundary) {
        await call.context.onSideEffectReceipt?.(sideEffect, {
          ok: false,
          error: settled.error instanceof Error ? settled.error.message : String(settled.error)
        });
      }
      throw settled.error;
    } else {
      result = {
        ok: false,
        error: settled.type === "timeout"
          ? `Tool ${tool.id} timed out after ${timeoutMs}ms.`
          : `Tool ${tool.id} was aborted.`
      };
    }
    if (hasSideEffectBoundary) {
      await call.context.onSideEffectReceipt?.(sideEffect, result);
    }
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
    } finally {
      releaseSideEffectSlot?.();
    }
  }

  private async acquireSideEffectSlot(): Promise<() => void> {
    const previous = this.sideEffectTail;
    let release!: () => void;
    this.sideEffectTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
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

    if (!this.approvalService) return "expired";
    return this.approvalService.waitForDecision({
      request,
      timeoutMs: 5 * 60 * 1000, // 5 minutes timeout
      pollMs: 500,
      signal: context.signal
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
