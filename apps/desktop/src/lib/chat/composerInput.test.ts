import assert from "node:assert/strict";
import test from "node:test";
import { shouldSubmitComposer, resolveComposerThinking } from "./composerInput";

test("composer Enter respects modifiers and WebKit composition in every host", () => {
  const event = { key: "Enter", shiftKey: false, altKey: false, isComposing: false, keyCode: 13 };
  assert.equal(shouldSubmitComposer(event as KeyboardEvent), true);
  for (const patch of [{shiftKey:true}, {altKey:true}, {isComposing:true}, {keyCode:229}, {key:"a"}]) assert.equal(shouldSubmitComposer({...event,...patch} as KeyboardEvent), false);
});
test("model thinking capability clamps fixed levels but preserves Auto", () => {
  assert.equal(resolveComposerThinking("high", ["off", "low"]), "low");
  assert.equal(resolveComposerThinking("auto", ["off"]), "auto");
});
