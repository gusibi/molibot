import { formatRunArchiveNotice } from "$lib/server/agent/session/runDetail.js";

/**
 * Shared onRunComplete handler that posts the run-archive notice for a turn.
 *
 * The `scopeId` is a REQUIRED construction parameter on purpose: the Weixin and
 * QQ closures this replaces both referenced an undefined ambient `scopeId`, and
 * because the enclosing `&&` chain short-circuits until a run actually produced
 * a thread event (which today only the model-fallback notice does), the
 * ReferenceError fired after the reply was already generated - the channel then
 * answered every fallback run with "Internal error." while the real reply sat
 * undelivered in the buffer. Forcing the scope through the parameter list makes
 * that failure impossible to write again, and the unit test drives the exact
 * fallback shape (`threadEventCount > 0`).
 */
export function createRunArchiveNoticeOnComplete(options: {
  scopeId: string;
  shouldSend: (scopeId: string) => boolean;
  sendVisibleText: (text: string) => Promise<unknown>;
}): (result: { stopReason: string; runId?: string }, meta: { threadEventCount: number }) => Promise<void> {
  return async (result, meta) => {
    if (
      result.stopReason === "stop" &&
      meta.threadEventCount > 0 &&
      result.runId &&
      options.shouldSend(options.scopeId)
    ) {
      await options.sendVisibleText(formatRunArchiveNotice(result.runId));
    }
  };
}
