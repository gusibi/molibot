import assert from "node:assert/strict";
import test from "node:test";
import { ConversationActivityCollector } from "./conversationActivity";

test("merges a tool start and end into one persisted activity", () => {
  let now = Date.parse("2026-08-10T10:00:00.000Z");
  const collector = new ConversationActivityCollector(() => now);
  const started = collector.record({
    type: "tool_execution_start",
    toolCallId: "call-read-settings",
    toolName: "read_file",
    displayName: "Read file",
    label: "Reading settings"
  });
  now += 2_300;
  const ended = collector.record({
    type: "tool_execution_end",
    toolCallId: "call-read-settings",
    toolName: "read_file",
    displayName: "Read file",
    isError: false,
    summary: "Loaded 42 lines"
  });

  assert.equal(ended?.key, started?.key);
  assert.deepEqual(collector.snapshot(), [{
    key: started?.key,
    kind: "tool",
    // The tool's own id, so a transcript can pick a renderer for the summary
    // without parsing it back out of `key` (whose shape exists for pairing).
    tool: "read_file",
    label: "Reading settings",
    state: "success",
    summary: "Loaded 42 lines",
    startedAt: "2026-08-10T10:00:00.000Z",
    finishedAt: "2026-08-10T10:00:02.300Z",
    durationMs: 2_300,
    lineCount: 1
  }]);
});

test("a file-mutating tool's unified patch is carried onto the activity", () => {
  const collector = new ConversationActivityCollector();
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-edit-app",
    toolName: "edit",
    displayName: "Edit",
    label: "Editing app.ts",
    paths: ["src/app.ts"],
    mutates: true
  });
  const ended = collector.record({
    type: "tool_execution_end",
    toolCallId: "call-edit-app",
    toolName: "edit",
    displayName: "Edit",
    isError: false,
    // The summary is what the *model* reads; the patch is for the person.
    summary: "Updated src/app.ts",
    diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n"
  });

  assert.equal(ended?.summary, "Updated src/app.ts");
  assert.match(ended?.diff ?? "", /@@ -1 \+1 @@/);
  assert.deepEqual(ended?.paths, ["src/app.ts"]);
  assert.equal(ended?.mutates, true);
});

test("a tool that produced no patch carries no diff field at all", () => {
  const collector = new ConversationActivityCollector();
  const ended = collector.record({
    type: "tool_execution_end",
    toolCallId: "call-bash-orphan",
    toolName: "bash",
    displayName: "Bash",
    isError: false,
    summary: "ok"
  });
  assert.equal("diff" in (ended ?? {}), false);
});

test("finalSnapshot closes still-running activities as errors", () => {
  const collector = new ConversationActivityCollector();
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-bash",
    toolName: "bash",
    displayName: "Bash",
    label: "Running script"
  });
  collector.record({
    type: "tool_execution_end",
    toolCallId: "call-bash",
    toolName: "bash",
    displayName: "Bash",
    isError: false,
    summary: "ok"
  });
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-search",
    toolName: "web_search",
    displayName: "Web search",
    label: "Searching"
  });
  // No end event for web_search: the run aborted/crashed mid-tool.

  assert.equal(collector.snapshot()[1].state, "running");

  const final = collector.finalSnapshot();
  assert.equal(final[0].state, "success");
  assert.equal(final[1].state, "error");
  assert.ok(final[1].summary);
});

test("file tool activities carry the touched path across the start/end merge", () => {
  const collector = new ConversationActivityCollector();
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-edit-guard",
    toolName: "edit",
    displayName: "Edit",
    label: "Edit: tighten the guard",
    paths: ["src/lib/guard.ts"],
    mutates: true
  });
  const ended = collector.record({
    type: "tool_execution_end",
    toolCallId: "call-edit-guard",
    toolName: "edit",
    displayName: "Edit",
    isError: false,
    summary: "Updated src/lib/guard.ts",
    fileOutput: { path: "src/lib/guard.ts", action: "modified" }
  });

  // `tool_execution_end` carries no arguments, so the paths recorded at start
  // are the only copy; losing them here would empty the session change view.
  assert.deepEqual(ended?.paths, ["src/lib/guard.ts"]);
  assert.equal(ended?.mutates, true);
  assert.deepEqual(ended?.fileOutput, { path: "src/lib/guard.ts", action: "modified" });
});

test("activities for tools without a file path stay free of path keys", () => {
  const collector = new ConversationActivityCollector();
  collector.record({ type: "tool_execution_start", toolCallId: "call-list", toolName: "bash", displayName: "Bash", label: "ls" });
  const ended = collector.record({
    type: "tool_execution_end",
    toolCallId: "call-list",
    toolName: "bash",
    displayName: "Bash",
    isError: false,
    summary: "ok"
  });
  assert.equal("paths" in (ended ?? {}), false);
  assert.equal("mutates" in (ended ?? {}), false);
});

test("pairs parallel calls of the same tool by their real toolCallId", () => {
  const collector = new ConversationActivityCollector();
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-read-a",
    toolName: "read_file",
    displayName: "Read file",
    label: "Read file: src/a.ts"
  });
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-read-b",
    toolName: "read_file",
    displayName: "Read file",
    label: "Read file: src/b.ts"
  });

  collector.record({
    type: "tool_execution_end",
    toolCallId: "call-read-a",
    toolName: "read_file",
    displayName: "Read file",
    isError: false,
    summary: "a"
  });

  assert.deepEqual(
    collector.snapshot().map(({ key, label, state }) => ({ key, label, state })),
    [
      { key: "call-read-a", label: "Read file: src/a.ts", state: "success" },
      { key: "call-read-b", label: "Read file: src/b.ts", state: "running" }
    ]
  );
});

test("duplicate lifecycle sources stay one row for the same toolCallId", () => {
  const collector = new ConversationActivityCollector();
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-edit",
    toolName: "edit",
    displayName: "Edit",
    label: "Edit: src/app.ts",
    paths: ["src/app.ts"],
    mutates: true
  });
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-edit",
    toolName: "edit",
    displayName: "Edit",
    label: "Tool started: Edit"
  });
  collector.record({
    type: "tool_execution_end",
    toolCallId: "call-edit",
    toolName: "edit",
    displayName: "Edit",
    isError: false,
    summary: "Tool finished: Edit"
  });
  collector.record({
    type: "tool_execution_end",
    toolCallId: "call-edit",
    toolName: "edit",
    displayName: "Edit",
    isError: false,
    summary: "Updated src/app.ts"
  });

  assert.equal(collector.snapshot().length, 1);
  assert.deepEqual(collector.snapshot()[0], {
    key: "call-edit",
    kind: "tool",
    tool: "edit",
    label: "Edit: src/app.ts",
    state: "success",
    summary: "Updated src/app.ts",
    startedAt: collector.snapshot()[0].startedAt,
    finishedAt: collector.snapshot()[0].finishedAt,
    durationMs: collector.snapshot()[0].durationMs,
    lineCount: 1,
    paths: ["src/app.ts"],
    mutates: true
  });
});

test("closeRunningActivities returns only interrupted ones and agrees with finalSnapshot", () => {
  const collector = new ConversationActivityCollector();
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-done",
    toolName: "read",
    displayName: "Read",
    label: "read config"
  });
  collector.record({
    type: "tool_execution_end",
    toolCallId: "call-done",
    toolName: "read",
    displayName: "Read",
    isError: false,
    summary: "ok"
  });
  collector.record({
    type: "tool_execution_start",
    toolCallId: "call-subagent",
    toolName: "subagent",
    displayName: "Subagent",
    label: "worker task"
  });
  // No tool_execution_end for call-subagent: the delegation was aborted and
  // its end frame never reached the collector.
  const closed = collector.closeRunningActivities();

  assert.equal(closed.length, 1);
  assert.equal(closed[0].key, "call-subagent");
  assert.equal(closed[0].state, "error");
  assert.equal(closed[0].summary, "Interrupted before completion.");
  // Closing is in place: the persisted snapshot and the streamed terminal
  // cards must agree (same key, same terminal state).
  const persisted = collector.finalSnapshot();
  assert.equal(persisted.find((activity) => activity.key === "call-subagent")?.state, "error");
  assert.equal(persisted.find((activity) => activity.key === "call-done")?.state, "success");
  // A second close is a no-op: every activity is already terminal.
  assert.deepEqual(collector.closeRunningActivities(), []);
});
