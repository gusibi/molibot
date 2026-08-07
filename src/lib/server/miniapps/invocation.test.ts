import assert from "node:assert/strict";
import test from "node:test";
import { formatMiniAppList, resolveMiniAppInvocation } from "$lib/server/miniapps/invocation.js";
import { buildPromptInputEnvelope } from "$lib/server/agent/prompts/promptInput.js";
import type { MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";

const todo: MiniAppCatalogEntry = {
  id: "todo", name: "Todo", version: "1.0.0", description: "Shared tasks.",
  status: "active", enabled: true, builtin: true, hasUi: true, toolNames: ["add", "list"], messageActions: [], iconDataUri: "",
  source: { kind: "builtin" }, updateAvailable: false, availableVersion: "1.0.0"
};

test("a leading @Mini App selector routes one turn and leaves only user intent", () => {
  assert.deepEqual(resolveMiniAppInvocation("@todo add milk", [todo]), { app: todo, text: "add milk", selector: "@todo" });
  assert.deepEqual(resolveMiniAppInvocation("@Todo   添加牛奶", [todo]), { app: todo, text: "添加牛奶", selector: "@Todo" });
});

test("mentions not at the start and disabled apps are ordinary text", () => {
  assert.equal(resolveMiniAppInvocation("please ask @todo later", [todo]), null);
  assert.equal(resolveMiniAppInvocation("@todo add milk", [{ ...todo, enabled: false, status: "disabled" }]), null);
});

test("the list is safe for channels and advertises the @ selector", () => {
  const text = formatMiniAppList([todo]);
  assert.match(text, /@todo/);
  assert.match(text, /Tools: @todo add, @todo list/);
  assert.doesNotMatch(text, /\/Users\//);
});

test("Mini App routing control is model-only and never enters persisted context", () => {
  const envelope = buildPromptInputEnvelope({
    messageText: "add milk",
    runtimeInstructions: ["Use only Todo Mini App tools for this turn."],
    timezone: "Asia/Shanghai"
  });
  assert.match(envelope.modelMessage, /<runtime-control>/);
  assert.match(envelope.modelMessage, /Todo Mini App/);
  assert.doesNotMatch(envelope.persistedMessage, /runtime-control|Todo Mini App/);
  assert.equal(envelope.persistedMessage, "add milk");
});

test("the @selector survives into the transcript but never into the model message", () => {
  const invocation = resolveMiniAppInvocation("@todo 帮我添加一个任务", [todo]);
  assert.ok(invocation);
  const envelope = buildPromptInputEnvelope({
    messageText: invocation.text,
    persistedText: `${invocation.selector} ${invocation.text}`,
    timezone: "Asia/Shanghai"
  });
  // Without this the owner's own message loses the token they typed, and the
  // session list shows a message they cannot recognize.
  assert.equal(envelope.persistedMessage, "@todo 帮我添加一个任务");
  assert.doesNotMatch(envelope.modelMessage, /@todo/);
});
