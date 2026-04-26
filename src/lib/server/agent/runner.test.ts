import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantStreamEvent } from "./assistantStream.js";

test("applyAssistantStreamEvent resets buffered assistant text on a new assistant message", () => {
  const afterDelta = applyAssistantStreamEvent(
    { assistantTextStreamed: false, streamedAssistantText: "" },
    { type: "text_delta", delta: "partial answer" }
  );
  assert.equal(afterDelta.assistantTextStreamed, true);
  assert.equal(afterDelta.streamedAssistantText, "partial answer");

  const afterRestart = applyAssistantStreamEvent(afterDelta, {
    type: "message_start",
    role: "assistant"
  });
  assert.deepEqual(afterRestart, {
    assistantTextStreamed: false,
    streamedAssistantText: ""
  });
});
