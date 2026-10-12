import assert from "node:assert/strict";
import test from "node:test";
import { projectAgentBindings } from "./agentBindings";
const items = [
  {channel: "feishu", id: "same", name: "Feishu bot", agentId: "default"},
  {channel: "telegram", id: "same", name: "Telegram bot", agentId: "coach"},
  {channel: "qq", id: "third", name: "QQ bot", agentId: "researcher"}
];
test("Agent binding view shows only its own bots and keeps other assignments available", () => {
  const view = projectAgentBindings(items, "coach", {});
  assert.deepEqual(view.bound.map(item => item.channel), ["telegram"]);
  assert.deepEqual(view.available.map(item => item.channel), ["feishu", "qq"]);
  assert.deepEqual(view.changes, []);
});
test("binding a bot drafts an explicit reassignment without changing other channels", () => {
  const before = structuredClone(items);
  const edits = {"feishu:same": true};
  const view = projectAgentBindings(items, "coach", edits);
  assert.deepEqual(view.bound.map(item => item.channel), ["feishu", "telegram"]);
  assert.deepEqual(view.changes, [{channel: "feishu", id: "same", agentId: "coach"}]);
  assert.equal(view.pending[0].agentId, "default");
  assert.deepEqual(items, before);
  delete (edits as Record<string, boolean>)["feishu:same"];
  assert.deepEqual(projectAgentBindings(items, "coach", edits).changes, []);
});
test("transfer to Momo removes a bot from the Agent draft and can be undone", () => {
  const view = projectAgentBindings(items, "coach", {"telegram:same": false});
  assert.equal(view.bound.length, 0);
  assert.deepEqual(view.changes, [{channel: "telegram", id: "same", agentId: "default"}]);
  assert.equal(projectAgentBindings(items, "coach", {}).bound.length, 1);
});
test("Momo never creates an empty bot identity or a redundant change", () => {
  const view = projectAgentBindings(items, "default", {"feishu:same": false, "telegram:same": true});
  assert.deepEqual(view.bound.map(item => item.channel), ["feishu", "telegram"]);
  assert.deepEqual(view.changes, [{channel: "telegram", id: "same", agentId: "default"}]);
});
