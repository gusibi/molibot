import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { buildBrokerApprovalRecord } from "$lib/server/agent/tools/toolRuntime.js";
import { buildHostBashApprovalPrompt, type HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import type { DesktopApprovalDecision } from "$lib/shared/desktop.js";

export function listDesktopBrokerApprovals(
  broker: ApprovalBroker,
  sessionId: string
): HostBashApprovalPrompt[] {
  return broker
    .listPendingRequests()
    .filter((request) => request.sessionId === sessionId)
    .map((request) => {
      const toolId = request.action.toolName || request.capability;
      return buildHostBashApprovalPrompt(buildBrokerApprovalRecord({
        request,
        actorId: request.actorId,
        toolId,
        displayName: toolId,
        command: request.action.command ?? request.action.path ?? toolId,
        status: "pending"
      }));
    });
}

export function resolveDesktopBrokerApproval(
  broker: ApprovalBroker,
  input: {
    sessionId: string;
    requestId: string;
    decision: DesktopApprovalDecision;
  }
): { status: "approved" | "rejected" } | null {
  const request = broker.getRequest(input.requestId);
  if (request?.status !== "pending" || request.sessionId !== input.sessionId) return null;

  const status = input.decision === "reject" ? "rejected" : "approved";
  const selectedScope = input.decision === "approve_session"
    ? "session"
    : input.decision === "approve_persistent"
      ? "persistent"
      : "once";
  const resolved = broker.resolveRequest({
    requestId: input.requestId,
    status,
    ...(status === "approved" ? { selectedScope } : {})
  });
  return resolved.request ? { status } : null;
}
