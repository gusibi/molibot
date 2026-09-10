import type { ToolResult } from "$lib/server/agent/tools/toolTypes.js";

/**
 * The run-level metadata status every approval suspension carries. The resume
 * path (`resumeSuspendedBrokerApproval`) finds the suspended run row through
 * the same literal, so this is a cross-layer contract, not a local constant.
 */
export const APPROVAL_WAITING_METADATA_STATUS = "waiting_for_approval";

/**
 * The inline handshake window shared by every approval backend (generic broker
 * tools and Host Bash). It exists to keep the common case smooth — a user
 * watching the screen approves within seconds and the command runs inline —
 * never as a deadline for the decision: past the window the run suspends
 * cleanly and the request stays pending until the user answers (issue #48:
 * "审批超过现有握手窗口仍保持有效等待"). One constant because two backends with
 * two windows behaved differently at the same seam (pitfall 43).
 */
export const APPROVAL_INLINE_HANDSHAKE_WINDOW_MS = 30_000;

/**
 * The one shape a tool returns when its run must suspend for a user decision:
 * caller-deferred (`onApprovalRequest` -> "defer"), inline window elapsed, or
 * the request record vanished mid-wait. `terminate` is unconditional — a wait
 * must always stop the tool loop, including mixed batches where sibling tools
 * completed normally (issue #48). The out-of-band approve -> resume flow finds
 * the suspended entry again by `details.approvalRequestId`.
 */
export function buildApprovalSuspensionResult(input: {
  requestId: string;
  /** The rendered approval card (`HostBashApprovalPrompt`) forwarded to clients. */
  prompt?: unknown;
  errorText?: string;
  /** Backend-specific details preserved alongside the resume locator. */
  extraDetails?: Record<string, any>;
}): ToolResult {
  return {
    ok: false,
    error: input.errorText ?? "Tool execution is waiting for user approval.",
    metadata: {
      approvalRequestId: input.requestId,
      status: APPROVAL_WAITING_METADATA_STATUS
    },
    details: {
      ...(input.extraDetails ?? {}),
      ...(input.prompt !== undefined ? { hostBashApproval: input.prompt } : {}),
      approvalRequestId: input.requestId
    },
    terminate: true
  };
}
