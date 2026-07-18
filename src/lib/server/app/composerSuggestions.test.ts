import assert from "node:assert/strict";
import test from "node:test";
import { buildComposerSuggestions, classifyComposerInvocation } from "./composerSuggestions.js";

test("composer suggestions merge registered commands with enabled Skills", () => {
  const suggestions = buildComposerSuggestions([
    { id: "web", name: "web-search", description: "Search", scope: "global", enabled: true, mcpServerCount: 0, botId: "", chatId: "" },
    { id: "off", name: "disabled", description: "Off", scope: "bot", enabled: false, mcpServerCount: 0, botId: "moli", chatId: "" }
  ], "en");
  assert.ok(suggestions.some((item) => item.label === "/models" && item.kind === "command"));
  assert.ok(suggestions.some((item) => item.label === "/web-search" && item.kind === "skill"));
  assert.equal(suggestions.some((item) => item.label === "/disabled"), false);
  assert.equal(suggestions.some((item) => item.label === "/login"), false);
  assert.equal(suggestions.some((item) => item.label === "/logout"), false);
});

test("invocation classification only recognizes catalog entries", () => {
  const suggestions = buildComposerSuggestions([], "zh");
  assert.deepEqual(classifyComposerInvocation("/compact 保留决策", suggestions), { kind: "command", token: "/compact" });
  assert.equal(classifyComposerInvocation("/unknown text", suggestions), null);
  assert.equal(classifyComposerInvocation("docs/path", suggestions), null);
});
