import assert from "node:assert/strict";
import test from "node:test";
import { ConversationActivityCollector } from "./conversationActivity";

test("merges a tool start and end into one persisted activity", () => {
  const collector = new ConversationActivityCollector();
  const started = collector.record({
    type: "tool_execution_start",
    toolName: "read_file",
    displayName: "Read file",
    label: "Reading settings"
  });
  const ended = collector.record({
    type: "tool_execution_end",
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
    label: "Read file",
    state: "success",
    summary: "Loaded 42 lines"
  }]);
});

test("a file-mutating tool's unified patch is carried onto the activity", () => {
  const collector = new ConversationActivityCollector();
  collector.record({
    type: "tool_execution_start",
    toolName: "edit",
    displayName: "Edit",
    label: "Editing app.ts",
    paths: ["src/app.ts"],
    mutates: true
  });
  const ended = collector.record({
    type: "tool_execution_end",
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
    toolName: "bash",
    displayName: "Bash",
    label: "Running script"
  });
  collector.record({
    type: "tool_execution_end",
    toolName: "bash",
    displayName: "Bash",
    isError: false,
    summary: "ok"
  });
  collector.record({
    type: "tool_execution_start",
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
    toolName: "edit",
    displayName: "Edit",
    label: "Edit: tighten the guard",
    paths: ["src/lib/guard.ts"],
    mutates: true
  });
  const ended = collector.record({
    type: "tool_execution_end",
    toolName: "edit",
    displayName: "Edit",
    isError: false,
    summary: "Updated src/lib/guard.ts"
  });

  // `tool_execution_end` carries no arguments, so the paths recorded at start
  // are the only copy; losing them here would empty the session change view.
  assert.deepEqual(ended?.paths, ["src/lib/guard.ts"]);
  assert.equal(ended?.mutates, true);
});

test("activities for tools without a file path stay free of path keys", () => {
  const collector = new ConversationActivityCollector();
  collector.record({ type: "tool_execution_start", toolName: "bash", displayName: "Bash", label: "ls" });
  const ended = collector.record({
    type: "tool_execution_end",
    toolName: "bash",
    displayName: "Bash",
    isError: false,
    summary: "ok"
  });
  assert.equal("paths" in (ended ?? {}), false);
  assert.equal("mutates" in (ended ?? {}), false);
});
