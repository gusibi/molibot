/**
 * Decoupled observation seam for approval decisions.
 *
 * The approval stores (Host Bash, ApprovalBroker) own the decision; trace
 * observability only needs to observe it. Emitting here instead of importing the
 * trace store keeps the approval layer free of observability dependencies, and a
 * listener failure can never break a user's approve/reject.
 */
export type ApprovalResolutionStatus = "approved" | "rejected" | "expired";

type ApprovalResolutionListener = (
  approvalId: string,
  status: ApprovalResolutionStatus,
  resolvedAt: Date
) => void;

const listeners = new Set<ApprovalResolutionListener>();

export function onApprovalResolved(listener: ApprovalResolutionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitApprovalResolved(
  approvalId: string,
  status: ApprovalResolutionStatus,
  resolvedAt: Date = new Date()
): void {
  if (!approvalId) return;
  for (const listener of listeners) {
    try {
      listener(approvalId, status, resolvedAt);
    } catch {
      // Observability must never break an approval decision.
    }
  }
}

/** Test seam: drops listeners so cases do not leak into each other. */
export function resetApprovalResolutionListenersForTests(): void {
  listeners.clear();
}
