import test from "node:test";
import assert from "node:assert/strict";
import { buildMoryWritePlan } from "./moryCore.js";
import { promptMemoryNamespaces } from "./namespaces.js";

const scope = { channel: "web", externalUserId: "chat-1", botId: "momo", ownerId: "owner" };

test("structured memories use a stable canonical path and domain namespace", () => {
  const first = buildMoryWritePlan(scope, { content: "简洁", domain: "owner", type: "user_preference", subject: "answer_length" }, "简洁", "long_term", "2026-07-11T10:00:00.000Z");
  const second = buildMoryWritePlan(scope, { content: "详细", domain: "owner", type: "user_preference", subject: "answer_length" }, "详细", "long_term", "2026-07-12T10:00:00.000Z");
  assert.equal(first.path, "mory://user_preference/answer_length");
  assert.equal(second.path, first.path);
  assert.equal(first.namespace, "owner:owner");
  assert.equal(first.lowConfidencePath, false);
});

test("structured memories default to owner or current project namespace", () => {
  const ownerPlan = buildMoryWritePlan(scope, {
    content: "Uses concise answers",
    type: "user_preference",
    subject: "answer_length"
  }, "Uses concise answers", "long_term", "2026-07-11T10:00:00.000Z");
  assert.equal(ownerPlan.namespace, "owner:owner");
  assert.equal(ownerPlan.domain, "owner");

  const projectPlan = buildMoryWritePlan({ ...scope, projectId: "project-1" }, {
    content: "Use pnpm",
    type: "user_preference",
    subject: "package_manager"
  }, "Use pnpm", "long_term", "2026-07-11T10:00:00.000Z");
  assert.equal(projectPlan.namespace, "project:owner:project-1");
  assert.equal(projectPlan.domain, "project");
});

test("different subjects and namespaces cannot share a version chain", () => {
  const length = buildMoryWritePlan(scope, { content: "简洁", domain: "owner", type: "user_preference", subject: "answer_length" }, "简洁", "long_term", "2026-07-11T10:00:00.000Z");
  const language = buildMoryWritePlan(scope, { content: "中文", domain: "owner", type: "user_preference", subject: "language" }, "中文", "long_term", "2026-07-11T10:00:00.000Z");
  const local = buildMoryWritePlan(scope, { content: "简洁", namespace: "chat:momo:web:chat-1", domain: "owner", type: "user_preference", subject: "answer_length" }, "简洁", "long_term", "2026-07-11T10:00:00.000Z");
  assert.notEqual(length.path, language.path);
  assert.equal(length.path, local.path);
  assert.notEqual(length.namespace, local.namespace);
});

test("unstructured text keeps a unique low-confidence path", () => {
  const first = buildMoryWritePlan(scope, { content: "remember this" }, "remember this", "long_term", "2026-07-11T10:00:00.000Z");
  const second = buildMoryWritePlan(scope, { content: "remember this" }, "remember this", "long_term", "2026-07-12T10:00:00.000Z");
  assert.notEqual(first.path, second.path);
  assert.equal(first.namespace, "chat:momo:web:chat-1");
  assert.equal(first.lowConfidencePath, true);
});

test("Web and Telegram share owner namespace but retain separate chat namespaces", () => {
  const web = { channel: "web", externalUserId: "web-user", botId: "momo", ownerId: "owner" };
  const telegram = { channel: "telegram", externalUserId: "tg-user", botId: "momo", ownerId: "owner" };
  const webPlan = promptMemoryNamespaces(web);
  const telegramPlan = promptMemoryNamespaces(telegram);
  assert.equal(webPlan[0], "owner:owner");
  assert.equal(telegramPlan[0], "owner:owner");
  assert.notEqual(webPlan[1], telegramPlan[1]);
});
