import assert from "node:assert/strict";
import test from "node:test";
import { DisplayFormatter } from "$lib/server/agent/core/displayFormatter.js";

test("formatToolProgressText keeps new-mode running progress compact", () => {
  const formatter = new DisplayFormatter();
  formatter.feedEvent({
    type: "tool_execution_start",
    toolName: "videoGenerate",
    label: "videoGenerate"
  });

  assert.equal(
    formatter.formatToolProgressText({
      toolProgress: "new",
      showReasoning: "off",
      gatewayNotifyInterval: 0
    }),
    "⏳ videoGenerate..."
  );
});
