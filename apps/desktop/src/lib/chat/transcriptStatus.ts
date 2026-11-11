import type { TranscriptMessage } from "./transcript";
import { appModelErrorSummary } from "@molibot/shared/appModelError";

export type TurnStatus = {
  state: "complete" | "failed" | "stopped" | "waiting" | "unknown";
  error: string;
};

export function isStatusOnlyMessage(message: TranscriptMessage): boolean {
  if (message.role !== "assistant") return false;
  const error = message.errorMessage?.trim() ?? "";
  const summaries = error ? [appModelErrorSummary(error, true), appModelErrorSummary(error, false)] : [];
  const statusText = (text: string) => !text.trim() || text.trim() === error || summaries.includes(text.trim());
  return statusText(message.content)
    && !message.thinking?.trim() && !message.attachments?.length && !message.activities?.length
    && !(message.steps ?? []).some(step => (step.kind !== "text" && step.kind !== "result") || !statusText(step.content));
}

/** One terminal status per user turn; an earlier request error does not override a later answer. */
export function transcriptTurnStatuses(messages: TranscriptMessage[], showUnresolved = false): Map<number, TurnStatus> {
  const statuses = new Map<number, TurnStatus>();
  let lastUser = -1;
  let terminal = -1;
  let outcome: TurnStatus["state"] | undefined;
  let errors: string[] = [];
  const flush = () => {
    if (terminal >= 0 && outcome) statuses.set(terminal, { state: outcome, error: errors.join("\n\n") });
  };
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      flush(); lastUser = index; terminal = -1; outcome = undefined; errors = [];
      continue;
    }
    if (message.role !== "assistant") continue;
    const error = message.errorMessage?.trim();
    if (error && !errors.includes(error)) errors.push(error);
    const state = message.stopReason === "stop" ? "complete"
      : message.stopReason === "error" ? "failed"
        : message.stopReason === "aborted" ? "stopped"
          : message.stopReason === "waiting_for_approval" ? "waiting" : undefined;
    if (state) { terminal = index; outcome = state; }
  }
  flush();
  if (showUnresolved && lastUser >= 0 && terminal < 0) statuses.set(messages.length - 1, { state: "unknown", error: "" });
  return statuses;
}
