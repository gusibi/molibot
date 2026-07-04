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
