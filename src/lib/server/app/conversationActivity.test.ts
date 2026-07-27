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
    label: "Read file",
    state: "success",
    summary: "Loaded 42 lines"
  }]);
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
