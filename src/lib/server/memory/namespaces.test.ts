import test from "node:test";
import assert from "node:assert/strict";
import { chatNamespace, deriveMemoryAccessScope, namespaceForDomain, promptMemoryNamespaces } from "./namespaces.js";

test("namespace encoding isolates agent, bot, channel, chat, and project", () => {
  const scope = { channel: "web", externalUserId: "chat/1", botId: "momo", agentId: "researcher", ownerId: "owner", projectId: "alpha" };
  assert.equal(chatNamespace(scope), "chat:momo:web:chat%2F1");
  assert.equal(namespaceForDomain(scope, "project"), "project:owner:alpha");
  assert.equal(namespaceForDomain(scope, "agent_self"), "agent:researcher");
  assert.deepEqual(promptMemoryNamespaces(scope), [
    "owner:owner",
    "chat:momo:web:chat%2F1",
    "agent:researcher",
    "project:owner:alpha"
  ]);
});

test("content is never part of automatic prompt namespaces", () => {
  const namespaces = promptMemoryNamespaces({ channel: "telegram", externalUserId: "42", botId: "momo" });
  assert.equal(namespaces.some((value) => value.startsWith("content:")), false);
});

test("owner sharing can be disabled for multi-user conversations", () => {
  const namespaces = promptMemoryNamespaces({ channel: "telegram", externalUserId: "group", botId: "momo", shareOwner: false });
  assert.equal(namespaces.some((value) => value.startsWith("owner:")), false);
});

test("a Bot is never used as an Agent namespace", () => {
  const access = deriveMemoryAccessScope({ channel: "web", externalUserId: "chat", botId: "momo", ownerId: "owner", shareOwner: false });
  assert.deepEqual(access.authorizedNamespaces, ["chat:momo:web:chat"]);
  assert.equal(access.authorizedNamespaces.some((namespace) => namespace.startsWith("agent:")), false);
  assert.equal(access.authorizedNamespaces.some((namespace) => namespace.startsWith("owner:")), false);
  assert.equal(access.authorizedNamespaces.some((namespace) => namespace.startsWith("content:")), false);
  assert.throws(() => namespaceForDomain({ channel: "web", externalUserId: "chat", botId: "momo" }, "agent_self"), /Agent identity/);
});
