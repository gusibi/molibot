import assert from "node:assert/strict";
import test from "node:test";
import { buildComposerSuggestions, classifyComposerInvocation } from "./composerSuggestions.js";
import type { DesktopMiniAppItem } from "$lib/shared/desktop.js";

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

const miniApp: DesktopMiniAppItem = {
  id: "todo",
  name: "Todo",
  version: "1.0.0",
  description: "One shared todo list",
  status: "active",
  enabled: true,
  builtin: true,
  toolNames: ["add", "list"],
  iconDataUri: "",
  source: { kind: "builtin" },
  error: ""
};

test("installed Mini Apps are offered under the @ trigger", () => {
  const suggestions = buildComposerSuggestions([], "en", [
    miniApp,
    { ...miniApp, id: "off", name: "Off", enabled: false },
    { ...miniApp, id: "broken", name: "Broken", status: "error", error: "boom" }
  ]);
  const todo = suggestions.find((item) => item.id === "miniapp:todo");
  assert.ok(todo);
  assert.equal(todo.kind, "miniapp");
  assert.equal(todo.label, "@todo");
  // The inserted token must be exactly what the runner's selector parser accepts.
  assert.equal(todo.insertText, "@todo ");
  assert.equal(suggestions.some((item) => item.id === "miniapp:off"), false);
  assert.equal(suggestions.some((item) => item.id === "miniapp:broken"), false);
});

test("project custom commands lead the palette and never auto-send", () => {
  const suggestions = buildComposerSuggestions([], "en", [], [
    { name: "review", content: "Please review the diff and flag issues.", description: "Code review" }
  ]);
  const review = suggestions.find((item) => item.id === "project-command:review");
  assert.ok(review);
  assert.equal(review.kind, "command");
  assert.equal(review.label, "/review");
  // Completing fills the composer with the body (not the `/name` token)…
  assert.equal(review.insertText, "Please review the diff and flag issues.");
  // …and never auto-sends, so the user reviews then presses Enter.
  assert.equal(review.submitOnSelect, false);
  // Project commands lead so a Project's own commands surface first.
  assert.equal(suggestions[0].id, "project-command:review");
});

test("a leading @app selector classifies as a Mini App invocation", () => {
  const suggestions = buildComposerSuggestions([], "zh", [miniApp]);
  assert.deepEqual(
    classifyComposerInvocation("@todo 帮我添加一个任务", suggestions),
    { kind: "miniapp", token: "@todo" }
  );
  assert.equal(classifyComposerInvocation("@unknown 帮我添加一个任务", suggestions), null);
  // An e-mail address is not a selector: it is not at the start of the message.
  assert.equal(classifyComposerInvocation("写信给 a@todo.com", suggestions), null);
});
