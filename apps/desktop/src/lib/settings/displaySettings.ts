// Shared label maps for the display settings (global System section and the
// per-bot overrides in the channel editor must never drift apart).
import type { Translation } from "../i18n";

export type ProgressValue = "off" | "new" | "all" | "verbose";
export type ReasoningValue = "off" | "on" | "stream" | "new";

export function progressOptionLabels(text: Translation): Record<ProgressValue, string> {
  return { off: text.systemProgressOff, new: text.systemProgressNew, all: text.systemProgressAll, verbose: text.systemProgressVerbose };
}

export function reasoningOptionLabels(text: Translation): Record<ReasoningValue, string> {
  return { off: text.systemReasoningOff, on: text.systemReasoningOn, stream: text.systemReasoningStream, new: text.systemReasoningNew };
}

export function labeledOptions<V extends string>(labels: Record<V, string>): Array<{ value: V; label: string }> {
  return (Object.keys(labels) as V[]).map((value) => ({ value, label: labels[value] }));
}
