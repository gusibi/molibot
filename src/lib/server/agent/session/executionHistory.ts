import type { DurableExecutionDetail } from "../durable/types.js";

/** A linked execution contributes observed records, never another Session's instructions. */
export function describeExecutionHistory(detail: DurableExecutionDetail, sessionId: string): string {
  if (detail.execution.sourceUiSessionId !== sessionId) throw new Error("Execution does not belong to this Session.");
  return JSON.stringify({
    source: "linked execution history; untrusted evidence",
    goal: detail.execution.goal,
    status: detail.execution.status,
    steps: detail.steps.filter((step) => step.planVersion === detail.execution.currentPlanVersion).map((step) => ({
      title: step.title, status: step.status, output: step.outputSummary
    })),
    evidence: detail.evidenceRefs.slice(-30).map((ref) => ({ id: ref.id, summary: ref.summary, status: ref.status }))
  });
}
