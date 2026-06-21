import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalGrant, ApprovalMatchContext, ApprovalRequest, ApprovalScope } from "$lib/server/approval/approvalTypes.js";
import { pollUntilResolved } from "$lib/server/approval/approvalWaiter.js";

export type ApprovalDecision = "approved" | "rejected" | "expired";

export interface WaitForDecisionInput {
  request: ApprovalRequest;
  timeoutMs: number;
  pollMs: number;
  signal?: { readonly aborted: boolean };
  /** Injectable for tests. */
  now?: () => number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Unified approval contract — the Phase 2 façade. Both approval backends (the
 * ApprovalBroker request/grant flow and, later, the Host Bash store flow) will
 * implement this so callers (ToolRuntime, channel commands) talk to one
 * interface and the hand-written cross-store bridge can eventually go away.
 *
 * This first cut provides the broker-backed implementation only; behavior is
 * unchanged (same broker, same poll loop, same grant model).
 * See docs/designs/agent-runtime/approval-convergence-plan-2026-06-20.md.
 */
export interface ApprovalService {
  /** Return a matching active grant if the action is already approved, else null. */
  checkGrant(ctx: ApprovalMatchContext): ApprovalGrant | null;
  /** Persist a new pending approval request. */
  createRequest(request: ApprovalRequest): void;
  /** Read the current state of a request. */
  getRequest(id: string): ApprovalRequest | null;
  /** Block until the request reaches a terminal decision, times out, or is aborted. */
  waitForDecision(input: WaitForDecisionInput): Promise<ApprovalDecision>;
  /** Resolve a pending request (approve/reject), recording a grant on approval. */
  resolve(input: { requestId: string; status: "approved" | "rejected"; selectedScope?: ApprovalScope }): void;
}

export class BrokerApprovalService implements ApprovalService {
  constructor(private readonly broker: ApprovalBroker) {}

  checkGrant(ctx: ApprovalMatchContext): ApprovalGrant | null {
    return this.broker.checkGrant(ctx);
  }

  createRequest(request: ApprovalRequest): void {
    this.broker.createRequest(request);
  }

  getRequest(id: string): ApprovalRequest | null {
    return this.broker.getRequest(id);
  }

  async waitForDecision(input: WaitForDecisionInput): Promise<ApprovalDecision> {
    return pollUntilResolved<ApprovalDecision>({
      timeoutMs: input.timeoutMs,
      pollMs: input.pollMs,
      signal: input.signal,
      now: input.now,
      sleep: input.sleep,
      poll: () => {
        const req = this.broker.getRequest(input.request.id);
        if (req?.status === "approved") return { done: true, value: "approved" };
        if (req?.status === "rejected") return { done: true, value: "rejected" };
        if (req?.status === "expired") return { done: true, value: "expired" };
        return { done: false };
      },
      onAbort: () => "expired",
      onTimeout: () => {
        const req = this.broker.getRequest(input.request.id);
        if (req && req.status === "pending") {
          this.broker.updateRequest({
            ...req,
            status: "expired",
            resolvedAt: new Date().toISOString()
          });
        }
        return "expired";
      }
    });
  }

  resolve(input: { requestId: string; status: "approved" | "rejected"; selectedScope?: ApprovalScope }): void {
    this.broker.resolveRequest({
      requestId: input.requestId,
      status: input.status,
      selectedScope: input.selectedScope
    });
  }
}
