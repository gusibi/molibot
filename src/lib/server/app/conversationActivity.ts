import type { RunnerUiEvent } from "$lib/server/agent/core/types";
import type { ConversationActivity } from "$lib/shared/types/message";

const MAX_SUMMARY_LENGTH = 4_000;
const MAX_DIFF_LENGTH = 40_000;

export class ConversationActivityCollector {
  private activities: ConversationActivity[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  record(event: RunnerUiEvent): ConversationActivity | undefined {
    if (event.type === "tool_execution_start") {
      const existingIndex = this.activities.findIndex((candidate) => candidate.key === event.toolCallId);
      const existing = existingIndex >= 0 ? this.activities[existingIndex] : undefined;
      const incomingLabel = event.label || event.displayName || event.toolName;
      const activity: ConversationActivity = {
        key: event.toolCallId,
        kind: "tool",
        // The tool's own id, recorded rather than left to be parsed back out of
        // `key`: a surface that renders a `read` result differently from a
        // `bash` result must not depend on a key format that exists for
        // deduplication.
        tool: event.toolName,
        // ToolRuntime and the agent event stream can both report the same
        // lifecycle. Prefer the specific model-facing label over the runtime's
        // generic "Tool started" receipt, regardless of which arrives first.
        label: incomingLabel.startsWith("Tool started:") && existing?.label
          ? existing.label
          : incomingLabel,
        state: "running",
        startedAt: existing?.startedAt ?? event.startedAt ?? new Date(this.now()).toISOString(),
        // Only present when the tool actually takes a file path, so activities
        // for every other tool serialize exactly as they did before.
        ...(event.paths?.length
          ? { paths: [...event.paths], mutates: event.mutates === true }
          : existing?.paths?.length
            ? { paths: existing.paths, mutates: existing.mutates === true }
            : {})
      };
      if (existingIndex >= 0) this.activities[existingIndex] = activity;
      else this.activities.push(activity);
      return activity;
    }

    if (event.type !== "tool_execution_end") return undefined;

    const index = this.activities.findIndex((candidate) => candidate.key === event.toolCallId);

    const summary = event.summary.trim();
    // `tool_execution_end` has no arguments, so the file target recorded at
    // start is the only place the paths exist — carry it across the merge.
    const started = index >= 0 ? this.activities[index] : undefined;
    const diff = event.diff?.trim();
    const finishedAt = event.finishedAt ?? new Date(this.now()).toISOString();
    const activity: ConversationActivity = {
      key: event.toolCallId,
      kind: "tool",
      tool: event.toolName,
      label: started?.label || event.displayName || event.toolName,
      state: event.isError ? "error" : "success",
      summary: summary ? summary.slice(0, MAX_SUMMARY_LENGTH) : undefined,
      startedAt: started?.startedAt,
      finishedAt,
      ...(started?.startedAt ? {
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(started.startedAt))
      } : {}),
      ...(Number.isInteger(event.exitCode) ? { exitCode: event.exitCode } : {}),
      ...(Number.isInteger(event.lineCount) ? { lineCount: event.lineCount } : summary ? { lineCount: summary.split(/\r?\n/).length } : {}),
      ...(Number.isFinite(event.tokenUsage) ? { tokenUsage: event.tokenUsage } : {}),
      ...(diff ? { diff: diff.slice(0, MAX_DIFF_LENGTH) } : {}),
      ...(started?.paths?.length ? { paths: started.paths, mutates: started.mutates === true } : {})
    };

    if (index >= 0) this.activities[index] = activity;
    else this.activities.push(activity);
    return activity;
  }

  snapshot(): ConversationActivity[] {
    return this.activities.map((activity) => ({ ...activity }));
  }

  /**
   * Snapshot for persistence after the run has ended. Anything still "running"
   * can never finish (abort, crash, or a tool that never emitted its end
   * event), so it is closed out as an error — otherwise the transcript renders
   * a spinner forever.
   */
  finalSnapshot(): ConversationActivity[] {
    return this.activities.map((activity) =>
      activity.state === "running"
        ? { ...activity, state: "error" as const, summary: activity.summary ?? "Interrupted before completion." }
        : { ...activity }
    );
  }
}
