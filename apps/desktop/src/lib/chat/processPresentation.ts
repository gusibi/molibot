import type { Translation } from "../i18n";
import type { TranscriptProcessBlock } from "./transcript";

/** A short live status; the process disclosure owns all model-authored text. */
export function processPresentation(blocks: TranscriptProcessBlock[], copy: Translation) {
  const activities = blocks.flatMap(block => block.kind === "activities" ? block.activities : []);
  const running = activities.filter(activity => activity.state === "running");
  const current = running.find(activity => activity.kind === "tool" && activity.tool !== "subagent") ?? running.at(-1);
  const tool = current?.tool;
  const status = current?.kind === "subagent" || tool === "subagent" ? copy.progressDelegate
    : current?.kind === "retry" || tool === "retry" ? (current?.label || "正在重试连接")
    : tool === "read" ? copy.progressRead
    : tool === "write" || tool === "edit" || tool === "apply_patch" ? copy.progressWrite
    : tool === "bash" ? copy.progressCommand
    : tool === "skillSearch" || tool === "toolSearch" || tool === "webSearch" ? copy.progressSearch
    : current ? copy.progressTool : copy.progressThinking;
  const label = current?.label?.trim();
  const detail = label && label !== tool && !label.startsWith("Tool started:") && current?.kind === "tool" ? label : "";
  const starts = activities.flatMap(activity => activity.startedAt ? [Date.parse(activity.startedAt)] : []).filter(Number.isFinite);
  return { status, detail, startedAt: starts.length ? Math.min(...starts) : undefined };
}
