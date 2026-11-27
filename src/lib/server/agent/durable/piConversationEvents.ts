import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { NestedCallDoc, type Conversation, type ConversationView, type EntryRecord, type Harness,
  type LiveState, type NestedToolExecutionResult, type TaskId, type WatchEnd } from "@earendil-works/pi-durable";

type ToolCall = { toolCallId: string; toolName: string; parentToolCallId?: string };

export type PiConversationEvent =
  | { type: "snapshot"; entries: readonly EntryRecord[]; generation?: LiveState["generation"] }
  | { type: "entry_appended" | "message_end"; entry: EntryRecord }
  | { type: "message_start"; message: Message }
  | { type: "message_update"; message: AssistantMessage }
  | { type: "deferred_poll"; pollAt: number }
  | { type: "compaction_end"; taskId: TaskId }
  | { type: "task_failed"; kind: string; message: string }
  | ({ type: "tool_execution_start"; args: unknown } & ToolCall)
  | ({ type: "tool_execution_update"; output?: { set: string } | { append: string }; details?: JsonValue } & ToolCall)
  | ({ type: "tool_execution_end"; entry?: EntryRecord; result?: NestedToolExecutionResult } & ToolCall);

function live(view: ConversationView): LiveState {
  return view.docs["pi.live"] as LiveState ?? {};
}

function observationError(end: WatchEnd | undefined): Error | undefined {
  if (end?.kind !== "failed" && end?.kind !== "listener_error") return undefined;
  return end.error instanceof Error ? end.error : new Error(String(end.error));
}

type ConversationObserverHarness = Pick<Harness, "observeConversation" | "snapshot" | "getTask">;

/** Drain accepted revisions before publishing the terminal observation state. */

export async function observePiConversation(harness: ConversationObserverHarness, conversation: Pick<Conversation, "id">, context: Context,
  listener: (events: PiConversationEvent[]) => Promise<void>) {
  let resolveClosed!: (end: WatchEnd) => void;
  const closed = new Promise<WatchEnd>(resolve => { resolveClosed = resolve; });
  let terminal: WatchEnd | undefined;
  let previous: ConversationView;
  let start!: () => void;
  let detach: (() => void) | undefined;
  let queue = new Promise<void>(resolve => { start = resolve; });
  const finish = (end: WatchEnd) => {
    if (terminal) return;
    terminal = end;
    void queue.then(
      () => resolveClosed(end),
      error => resolveClosed(end.kind === "stopped"
        ? { kind: "listener_error", error: error instanceof Error ? error : new Error(String(error)) }
        : end)
    );
  };
  const observation = await harness.observeConversation(conversation.id, {
    advance(change) {
      if (terminal) return;
      // Attaching and receiving the first change can occur on the same Session line.
      queue = queue.then(async () => {
        if (change.kind === "failed") throw change.error;
        const next = change.value;
        const events = await projectRevision(harness, previous, next, context);
        if (events.length) await listener(events);
        previous = next;
      });
      void queue.catch(error => {
        if (terminal) return;
        detach?.();
        finish({ kind: "listener_error", error: error instanceof Error ? error : new Error(String(error)) });
      });
    },
    end: finish
  }, context);
  detach = () => observation.detach();
  previous = observation.value;
  const snapshot = { type: "snapshot" as const, entries: previous.entries, generation: live(previous).generation };
  const failure = closed.then(end => {
    const error = observationError(end);
    if (error) throw error;
    return new Promise<never>(() => undefined);
  });
  void failure.catch(() => undefined);
  return {
    snapshot, closed, failure, start,
    async flush() {
      await queue;
      const error = observationError(terminal);
      if (error) throw error;
    },
    async stop() {
      if (!terminal) detach?.();
      finish({ kind: "stopped" });
      start();
      return closed;
    }
  };
}

async function projectRevision(harness: ConversationObserverHarness, previous: ConversationView, next: ConversationView, context: Context): Promise<PiConversationEvent[]> {
  const before = live(previous);
  const after = live(next);
  const events: PiConversationEvent[] = [];
  const lastEntry = previous.entries.at(-1)?.id ?? previous.before ?? 0;
  const appended = next.entries.filter(entry => entry.id > lastEntry);
  const partial = after.generation?.message;
  if (partial && partial !== before.generation?.message) {
    events.push(before.generation?.message ? { type: "message_update", message: partial } : { type: "message_start", message: partial });
  }
  const pollAt = after.generation?.deferred?.pollAt;
  if (pollAt !== undefined && pollAt !== before.generation?.deferred?.pollAt) events.push({ type: "deferred_poll", pollAt });

  for (const entry of appended) {
    const message = entry.model?.[0];
    if (!message) events.push({ type: "entry_appended", entry });
    else {
      if (message.role !== "assistant" || !before.generation?.message) events.push({ type: "message_start", message });
      events.push({ type: "message_end", entry });
    }
  }

  const prior = new Map([...(before.tools ?? []), ...(before.nestedTools ?? [])].map(slot => [slot.callId, slot]));
  const current = new Map([...(after.tools ?? []), ...(after.nestedTools ?? [])].map(slot => [slot.callId, slot]));
  let toolArgs: Map<string, unknown> | undefined;
  for (const slot of current.values()) {
    const old = prior.get(slot.callId);
    const nested = "parentCallId" in slot ? slot : undefined;
    const call = { toolCallId: slot.callId, toolName: slot.name, parentToolCallId: nested?.parentCallId };
    if (slot.status === "running" && (!old || old.status === "pending")) {
      if (nested?.arguments == null && !toolArgs) {
        toolArgs = new Map();
        for (const entry of next.entries) {
          for (const message of entry.model ?? []) {
            if (message.role !== "assistant") continue;
            for (const block of message.content) {
              if (block.type === "toolCall" && !toolArgs.has(block.id)) toolArgs.set(block.id, block.arguments);
            }
          }
        }
      }
      const args = nested?.arguments ?? toolArgs?.get(slot.callId) ?? {};
      events.push({ type: "tool_execution_start", ...call, args });
    }
    if (slot.status === "running" && (slot.output !== old?.output || slot.details !== old?.details)) {
      events.push({ type: "tool_execution_update", ...call, output: slot.output === undefined ? undefined : { set: slot.output }, details: slot.details });
    }
  }
  for (const [id, slot] of [...new Map([...prior, ...current])].reverse()) {
    const old = prior.get(id);
    if (old?.status === "done" || (current.has(id) && slot.status !== "done")) continue;
    const call = { toolCallId: id, toolName: slot.name };
    let hasResult: boolean;
    if ("parentCallId" in slot) {
      const key = id.slice(slot.parentCallId.length + 1);
      const receipt = await harness.snapshot(NestedCallDoc, slot.parentTaskId, key, context);
      const result = receipt?.result ?? (slot.summary ? {
        taskId: slot.taskId, ...slot.summary,
        diagnostics: slot.summary.error ? [{ severity: "error" as const, message: slot.summary.error }] : []
      } : undefined);
      hasResult = result !== undefined;
      events.push({ type: "tool_execution_end", ...call, parentToolCallId: slot.parentCallId, result });
    } else {
      const entry = next.entries.find(item => item.id === slot.entry || item.model?.some(message => message.role === "toolResult" && message.toolCallId === id));
      hasResult = entry !== undefined;
      events.push({ type: "tool_execution_end", ...call, entry });
    }
    if (!hasResult && slot.taskId !== undefined) {
      const task = await harness.getTask(slot.taskId, context);
      const outcome = task?.state.status === "terminal" ? task.state.outcome : undefined;
      if (outcome?.status === "faulted" || outcome?.status === "orphaned") {
        events.push({ type: "task_failed", kind: task!.kind, message: outcome.status === "faulted" ? outcome.error.message : outcome.reason });
      }
    }
  }
  for (const { taskId } of before.compactions ?? []) {
    if (!after.compactions?.some(compaction => compaction.taskId === taskId)) events.push({ type: "compaction_end", taskId });
  }
  const failure = after.runFailure;
  if (failure !== before.runFailure && (failure?.reason === "faulted" || failure?.reason === "orphaned")) {
    events.push({ type: "task_failed", kind: "pi.generation", message: failure.detail ?? failure.reason });
  }
  return events;
}
