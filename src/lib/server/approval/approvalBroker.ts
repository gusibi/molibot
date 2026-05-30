import type { ApprovalGrant, ApprovalMatchContext, ApprovalRequest, ApprovalScope } from "$lib/server/approval/approvalTypes.js";

export interface ApprovalBrokerStore {
  listActiveGrants(): ApprovalGrant[];
  saveGrant(grant: ApprovalGrant): void;
  saveRequest(request: ApprovalRequest): void;
  updateRequest(request: ApprovalRequest): void;
  listPendingRequests(): ApprovalRequest[];
  getRequest(id: string): ApprovalRequest | null;
}

export class MemoryApprovalBrokerStore implements ApprovalBrokerStore {
  private readonly grants = new Map<string, ApprovalGrant>();
  private readonly requests = new Map<string, ApprovalRequest>();

  listActiveGrants(): ApprovalGrant[] {
    return Array.from(this.grants.values()).filter((grant) => !grant.revokedAt);
  }

  saveGrant(grant: ApprovalGrant): void {
    this.grants.set(grant.id, grant);
  }

  saveRequest(request: ApprovalRequest): void {
    this.requests.set(request.id, request);
  }

  updateRequest(request: ApprovalRequest): void {
    this.requests.set(request.id, request);
  }

  listPendingRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((request) => request.status === "pending");
  }

  getRequest(id: string): ApprovalRequest | null {
    return this.requests.get(id) ?? null;
  }
}

export class ApprovalBroker {
  constructor(private readonly store: ApprovalBrokerStore = new MemoryApprovalBrokerStore()) {}

  checkGrant(input: ApprovalMatchContext): ApprovalGrant | null {
    const now = input.now ?? new Date();
    for (const grant of this.store.listActiveGrants()) {
      if (!this.matchesGrant(grant, input, now)) continue;
      return grant;
    }
    return null;
  }

  createRequest(request: ApprovalRequest): ApprovalRequest {
    this.store.saveRequest(request);
    return request;
  }

  getRequest(id: string): ApprovalRequest | null {
    return this.store.getRequest(id);
  }

  updateRequest(request: ApprovalRequest): void {
    this.store.updateRequest(request);
  }

  resolveRequest(input: {
    requestId: string;
    status: "approved" | "rejected";
    selectedScope?: ApprovalScope;
    grantId?: string;
    resolvedAt?: Date;
  }): { request: ApprovalRequest | null; grant?: ApprovalGrant } {
    const request = this.store.getRequest(input.requestId);
    if (!request || request.status !== "pending") {
      return { request: null };
    }

    const resolvedAt = (input.resolvedAt ?? new Date()).toISOString();
    const nextRequest: ApprovalRequest = {
      ...request,
      status: input.status,
      selectedScope: input.selectedScope,
      resolvedAt
    };
    this.store.updateRequest(nextRequest);

    if (input.status !== "approved") {
      return { request: nextRequest };
    }

    const scope = input.selectedScope ?? "once";
    const grant: ApprovalGrant = {
      id: input.grantId ?? `${request.id}-grant`,
      scope,
      capability: request.capability,
      actorId: request.actorId,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      runId: request.runId,
      actionFingerprint: request.actionFingerprint,
      createdAt: resolvedAt
    };
    this.store.saveGrant(grant);
    return { request: nextRequest, grant };
  }

  expirePendingRequests(options: { now?: Date; timeoutMs: number }): ApprovalRequest[] {
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - options.timeoutMs;
    const expired: ApprovalRequest[] = [];

    for (const request of this.store.listPendingRequests()) {
      const createdAt = Date.parse(request.createdAt);
      if (!Number.isFinite(createdAt) || createdAt > cutoff) continue;
      const nextRequest: ApprovalRequest = {
        ...request,
        status: "expired",
        resolvedAt: now.toISOString()
      };
      this.store.updateRequest(nextRequest);
      expired.push(nextRequest);
    }

    return expired;
  }

  private matchesGrant(grant: ApprovalGrant, input: ApprovalMatchContext, now: Date): boolean {
    if (grant.revokedAt) return false;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= now.getTime()) return false;
    if (grant.capability !== input.capability) return false;
    if (grant.actorId !== input.actorId) return false;
    if (grant.actionFingerprint && grant.actionFingerprint !== input.actionFingerprint) return false;

    if (grant.scope === "persistent") return true;
    if (grant.scope === "workspace") return grant.workspaceId === input.workspaceId;
    if (grant.scope === "session") return grant.sessionId === input.sessionId;
    if (grant.scope === "turn" || grant.scope === "once") return grant.runId === input.runId;
    return false;
  }
}

import { SqliteApprovalStore } from "$lib/server/approval/approvalStore.js";

let approvalBroker: ApprovalBroker | null = null;

export function getApprovalBroker(): ApprovalBroker {
  if (!approvalBroker) {
    const store = new SqliteApprovalStore();
    approvalBroker = new ApprovalBroker(store);
  }
  return approvalBroker;
}

