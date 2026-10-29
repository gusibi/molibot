import { PiConversationRuntime, type PiConversationOptions } from "../piConversation.js";

/** Exercise the production lifecycle; normalize its outcome for process fixtures. */
export async function runPiConversation(options: PiConversationOptions, input: {
  requestId: string; text?: string; signal?: AbortSignal; resume?: boolean;
}) {
  const runtime = new PiConversationRuntime(options);
  const abort = () => { void runtime.abort().catch(() => undefined); };
  try {
    input.signal?.throwIfAborted();
    await runtime.open({ requestId: input.requestId, content: input.text ?? "", resume: input.resume });
    if (input.signal?.aborted) abort();
    else input.signal?.addEventListener("abort", abort, { once: true });
    const result = await runtime.runInput();
    const view = await runtime.context();
    return { status: result.status === "waiting_for_approval" ? result.status
      : result.outcome?.status === "done" ? "completed"
      : result.outcome?.status === "unanswered" && result.outcome.reason === "aborted" ? "cancelled" : "failed",
      submissionId: result.submissionId,
      approvalRequestId: result.status === "waiting_for_approval" ? result.requestId : undefined,
      entries: view.entries, messages: view.entries.flatMap(entry => entry.model ?? []), error: undefined as string | undefined };
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.startsWith("External operation outcome is unknown")) throw cause;
    const view = await runtime.context();
    return { status: "recovery_required", messages: view.entries.flatMap(entry => entry.model ?? []), entries: view.entries,
      submissionId: undefined, approvalRequestId: undefined, error: cause.message };
  } finally {
    input.signal?.removeEventListener("abort", abort);
    await runtime.close();
  }
}
