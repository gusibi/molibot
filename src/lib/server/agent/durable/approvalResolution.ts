import type { ApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { HostBashStore } from "$lib/server/hostBash/store.js";
import type { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionConflictError } from "./store.js";

/** Resolve the tool permission and queue its owning task through the same entry on every surface. */
export function resolveDurableToolApproval(
  services: { coordinator: DurableExecutionCoordinator; broker: ApprovalBroker; hostBashStore: HostBashStore },
  input: Parameters<DurableExecutionCoordinator["resolveApproval"]>[0]
) {
  const detail = services.coordinator.inspect(input.ownerId, input.executionId);
  const approval = detail.approvals.find((item) => item.id === input.approvalId);
  if (detail.execution.version !== input.expectedVersion) {
    throw new DurableExecutionConflictError(input.executionId, input.expectedVersion, detail.execution.version);
  }
  if (detail.execution.status !== "waiting_for_approval" || approval?.status !== "pending") {
    throw new Error("This task is no longer waiting for this approval.");
  }
  const selectedScope = input.selectedScope === "session" || input.selectedScope === "persistent" ? input.selectedScope : "once";
  if (approval.backend === "approval_broker") {
    const request = services.broker.getRequest(approval.requestId);
    if (!request || request.status !== "pending") throw new Error("The underlying approval request is no longer pending.");
    const resolved = services.broker.resolveRequest({
      requestId: approval.requestId, status: input.status === "approved" ? "approved" : "rejected",
      ...(input.status === "approved" ? { selectedScope } : {})
    });
    if (!resolved.request) throw new Error("The underlying approval request could not be resolved.");
  } else {
    const scopeId = detail.execution.sourceChatId;
    if (!scopeId) throw new Error("Durable approval has no source chat.");
    const resolved = input.status === "approved"
      ? services.hostBashStore.approve(scopeId, approval.requestId, { scope: selectedScope })
      : services.hostBashStore.reject(scopeId, approval.requestId);
    if (!resolved) throw new Error("The underlying Host Bash approval request is no longer pending.");
  }
  return services.coordinator.resolveApproval({ ...input, selectedScope });
}
