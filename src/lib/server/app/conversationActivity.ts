import type { RunnerUiEvent } from "$lib/server/agent/core/types";
import type { ConversationActivity } from "$lib/shared/types/message";

const MAX_SUMMARY_LENGTH = 4_000;

export class ConversationActivityCollector {
  private activities: ConversationActivity[] = [];
  private sequence = 0;

  record(event: RunnerUiEvent): ConversationActivity | undefined {
    if (event.type === "tool_execution_start") {
      const activity: ConversationActivity = {
        key: `${event.toolName}-${++this.sequence}`,
        kind: "tool",
        label: event.label || event.displayName || event.toolName,
        state: "running"
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
    const activity: ConversationActivity = {
      key: index >= 0 ? this.activities[index].key : `${event.toolName}-${++this.sequence}`,
      kind: "tool",
      label: event.displayName || event.toolName,
      state: event.isError ? "error" : "success",
      summary: summary ? summary.slice(0, MAX_SUMMARY_LENGTH) : undefined
    };

    if (index >= 0) this.activities[index] = activity;
    else this.activities.push(activity);
    return activity;
  }

  snapshot(): ConversationActivity[] {
    return this.activities.map((activity) => ({ ...activity }));
  }
}
