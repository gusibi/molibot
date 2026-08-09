import type { RunDetailEntry } from "$lib/server/agent/session/runDetail.js";
import { formatRunLogText } from "$lib/server/agent/session/runDetail.js";
import type { DurableExecutionDetail, EvidenceRef } from "./types.js";

const DEFAULT_MAX_BYTES = 24 * 1024;

export type DurableRunDetailReader = (input: {
  chatId: string;
  runId: string;
  sessionId?: string;
  projectId?: string;
}) => RunDetailEntry[];

export interface DurableEvidenceRead extends EvidenceRef {
  content?: string;
  truncated: boolean;
  untrusted: true;
}

function boundedText(value: string, maxBytes: number): { content: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return { content: value, truncated: false };
  return {
    content: new TextDecoder().decode(bytes.subarray(0, maxBytes)) + "\n[Evidence truncated.]",
    truncated: true
  };
}

function unavailable(ref: EvidenceRef, reason: string): DurableEvidenceRead {
  return {
    ...ref,
    status: "unavailable",
    unavailableReason: ref.unavailableReason ?? reason,
    truncated: false,
    untrusted: true
  };
}

function referencedRunId(ref: EvidenceRef): string {
  if (ref.referenceType === "ordinary-run-tool-result") {
    const separator = ref.referenceId.indexOf(":");
    return (separator < 0 ? ref.referenceId : ref.referenceId.slice(0, separator)).trim();
  }
  return ref.referenceId.trim();
}

function matchingAttempt(detail: DurableExecutionDetail, ref: EvidenceRef, runId: string) {
  if (!ref.attemptId) return undefined;
  const attempt = detail.attempts.find((item) => item.id === ref.attemptId);
  return attempt && attempt.runId === runId ? attempt : null;
}

export function readDurableEvidence(
  detail: DurableExecutionDetail,
  evidenceId: string,
  readRunDetail?: DurableRunDetailReader,
  maxBytes = DEFAULT_MAX_BYTES
): DurableEvidenceRead {
  const ref = detail.evidenceRefs.find((item) => item.id === evidenceId);
  if (!ref) throw new Error("Evidence reference not found.");
  if (ref.status === "unavailable") return unavailable(ref, "Evidence was marked unavailable by the runtime.");

  // Verifier evidence is already a bounded, durable summary. It does not need
  // to reopen an ordinary transcript.
  if (ref.referenceType === "durable-verifier" || ref.referenceType === "durable-queryable-probe") {
    const bounded = boundedText(ref.summary, Math.max(1024, Math.round(maxBytes)));
    return { ...ref, content: bounded.content, truncated: bounded.truncated, untrusted: true };
  }

  if (ref.referenceType !== "ordinary-run-tool-result" && ref.referenceType !== "run-detail") {
    return unavailable(ref, `Evidence type '${ref.referenceType}' has no readable artifact adapter.`);
  }
  const runId = referencedRunId(ref);
  if (!runId) return unavailable(ref, "Evidence does not identify a run detail.");
  const attempt = matchingAttempt(detail, ref, runId);
  if (ref.attemptId && attempt === null) {
    return unavailable(ref, "Evidence is not attached to the referenced Durable attempt.");
  }
  if (!detail.execution.sourceChatId) return unavailable(ref, "The source chat for this evidence is unavailable.");
  if (!readRunDetail) return unavailable(ref, "The source channel is not available to read this evidence.");

  const entries = readRunDetail({
    chatId: detail.execution.sourceChatId,
    runId,
    sessionId: attempt?.contextSessionId ?? detail.execution.sourceUiSessionId,
    projectId: detail.execution.sourceProjectId
  });
  if (entries.length === 0) return unavailable(ref, "The referenced run detail is unavailable.");
  const rendered = formatRunLogText(runId, entries, 1000);
  const bounded = boundedText(rendered, Math.max(1024, Math.round(maxBytes)));
  return { ...ref, content: bounded.content, truncated: bounded.truncated, untrusted: true };
}
