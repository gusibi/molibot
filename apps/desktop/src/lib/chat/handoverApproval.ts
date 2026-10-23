import type { DesktopDurableExecutionActionRequest, DesktopHandoverPending } from "@molibot/desktop-contract";

export type HandoverApprovalDecision = "approve_once" | "reject";

/**
 * PA-HD9: one pending approval, one owner, so the Handover resolves each item
 * through the record that actually holds it.
 *
 * A Durable or Plan approval has its own row id and execution version; the
 * tool-approval bridge clears that row together with its Broker or Host Bash
 * record. A plain Host Bash approval has only its request id. Sending the wrong
 * one leaves the execution waiting after the card disappears.
 */
export type HandoverApprovalAction =
  | { kind: "durable"; input: DesktopDurableExecutionActionRequest }
  | { kind: "host-bash"; requestId: string };

export function handoverApprovalAction(
  item: Pick<DesktopHandoverPending, "requestId" | "approvalId" | "executionId" | "expectedVersion">,
  decision: HandoverApprovalDecision,
  actionId: string
): HandoverApprovalAction | null {
  if (item.executionId && item.approvalId) {
    return {
      kind: "durable",
      input: {
        action: "resolve_approval",
        executionId: item.executionId,
        approvalId: item.approvalId,
        status: decision === "reject" ? "rejected" : "approved",
        ...(decision === "reject" ? {} : { selectedScope: "once" }),
        expectedVersion: Number(item.expectedVersion ?? 0),
        actionId
      }
    };
  }
  if (item.requestId) return { kind: "host-bash", requestId: item.requestId };
  return null;
}
