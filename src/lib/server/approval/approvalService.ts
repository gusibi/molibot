import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { ApprovalGrant, ApprovalMatchContext, ApprovalRequest, ApprovalScope } from "$lib/server/approval/approvalTypes.js";
import { pollUntilResolved } from "$lib/server/approval/approvalWaiter.js";

export type ApprovalDecision = "approved" | "rejected" | "expired" | "window_expired";

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
  /**
   * Drop a pending request into its `expired` terminal state. Called when the
   * waiting run was aborted: an aborted wait has no consumer left, so a request
   * that stays `pending` forever shows a card whose later approval can do
   * nothing - the exact "已审批但还是卡着" failure.
   */
  expireRequest(id: string): void;
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
      onAbort: () => {
        // The waiting run is gone; nobody will ever consume a later decision.
        // Leave a terminal state behind instead of a card that lies.
        this.expireRequest(input.request.id);
        return "expired";
      },
      onTimeout: () => {
        // The inline handshake window elapsed. The request stays pending on
        // purpose: the run suspends and the out-of-band approve -> resume path
        // takes over, so the user may still answer hours (or days) later.
        return "window_expired";
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

  expireRequest(id: string): void {
    const req = this.broker.getRequest(id);
    if (!req || req.status !== "pending") return;
    this.broker.updateRequest({
      ...req,
      status: "expired",
      resolvedAt: new Date().toISOString()
    });
  }
}
