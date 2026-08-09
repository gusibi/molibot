import type { RunnerUiEvent } from "$lib/server/agent/core/types";
import type { ConversationActivity } from "$lib/shared/types/message";

const MAX_SUMMARY_LENGTH = 4_000;
const MAX_DIFF_LENGTH = 40_000;

export class ConversationActivityCollector {
  private activities: ConversationActivity[] = [];
  private sequence = 0;

  record(event: RunnerUiEvent): ConversationActivity | undefined {
    if (event.type === "tool_execution_start") {
      const activity: ConversationActivity = {
        key: `${event.toolName}-${++this.sequence}`,
        kind: "tool",
        // The tool's own id, recorded rather than left to be parsed back out of
        // `key`: a surface that renders a `read` result differently from a
        // `bash` result must not depend on a key format that exists for
        // deduplication.
        tool: event.toolName,
        label: event.label || event.displayName || event.toolName,
        state: "running",
        // Only present when the tool actually takes a file path, so activities
        // for every other tool serialize exactly as they did before.
        ...(event.paths?.length ? { paths: [...event.paths], mutates: event.mutates === true } : {})
      };
      this.activities.push(activity);
      return activity;
    }

    if (event.type !== "tool_execution_end") return undefined;

    let index = -1;
    for (let position = this.activities.length - 1; position >= 0; position -= 1) {
      const candidate = this.activities[position];
      if (
        candidate.kind === "tool" &&
        candidate.state === "running" &&
        candidate.key.startsWith(`${event.toolName}-`)
      ) {
        index = position;
        break;
      }
    }

    const summary = event.summary.trim();
    // `tool_execution_end` has no arguments, so the file target recorded at
    // start is the only place the paths exist — carry it across the merge.
    const started = index >= 0 ? this.activities[index] : undefined;
    const diff = event.diff?.trim();
    const activity: ConversationActivity = {
      key: started?.key ?? `${event.toolName}-${++this.sequence}`,
      kind: "tool",
      tool: event.toolName,
      label: event.displayName || event.toolName,
      state: event.isError ? "error" : "success",
      summary: summary ? summary.slice(0, MAX_SUMMARY_LENGTH) : undefined,
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
