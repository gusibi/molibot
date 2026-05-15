import type { RunnerUiEvent } from "./types.js";

type SubagentRunnerEvent = Extract<RunnerUiEvent, { type: "subagent_execution" }>;

function compactWhitespace(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function previewTask(text: string | undefined, maxLength = 72): string {
  const compact = compactWhitespace(text ?? "");
  if (!compact) return "";
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

export function formatSubagentProgressLabel(event: SubagentRunnerEvent): string {
  const agent = event.agent?.trim() || "subagent";
  const indexLabel =
    typeof event.taskIndex === "number" && event.taskCount > 1
      ? ` (${event.taskIndex}/${event.taskCount})`
      : "";
  const taskPreview = previewTask(event.task);

  if (event.phase === "start") {
    return `Sub Agent started: ${event.mode} mode, ${event.taskCount} task${event.taskCount === 1 ? "" : "s"}`;
  }
  if (event.phase === "task_start") {
    return taskPreview
      ? `Sub Agent task started${indexLabel}: ${agent} - ${taskPreview}`
      : `Sub Agent task started${indexLabel}: ${agent}`;
  }
  if (event.phase === "task_end") {
    const suffix = event.stopReason && event.stopReason !== "stop" ? ` (${event.stopReason})` : "";
    return `Sub Agent task finished${indexLabel}: ${agent}${suffix}`;
  }
  const suffix = event.stopReason && event.stopReason !== "stop" ? ` (${event.stopReason})` : "";
  return `Sub Agent finished: ${event.taskCount} task${event.taskCount === 1 ? "" : "s"}${suffix}`;
}

export function formatSubagentProgressSummary(event: SubagentRunnerEvent): string {
  if (event.phase === "task_end") {
    const parts: string[] = [event.stopReason ?? "stop"];
    const errorMessage = compactWhitespace(event.errorMessage ?? "");
    if (errorMessage) parts.push(errorMessage);
    return parts.join(" - ");
  }
  if (event.phase === "end") {
    return event.stopReason ?? "stop";
  }
  return event.task ? previewTask(event.task, 120) : event.mode;
}

export function buildSubagentDiagnostic(event: SubagentRunnerEvent): string {
  const parts = [
    `subagent_phase=${event.phase}`,
    `mode=${event.mode}`,
    `tasks=${event.taskCount}`
  ];
  if (event.agent) parts.push(`agent=${event.agent}`);
  if (typeof event.taskIndex === "number") parts.push(`task_index=${event.taskIndex}`);
  if (event.stopReason) parts.push(`status=${event.stopReason}`);
  const taskPreview = previewTask(event.task, 120);
  if (taskPreview) parts.push(`task=${taskPreview}`);
  const errorMessage = compactWhitespace(event.errorMessage ?? "");
  if (errorMessage) parts.push(`error=${previewTask(errorMessage, 120)}`);
  return parts.join(", ");
}
