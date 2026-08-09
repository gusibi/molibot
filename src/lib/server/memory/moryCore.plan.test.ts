import test from "node:test";
import assert from "node:assert/strict";
import { buildRetrievalPlan } from "#mory";
import { buildMoryWritePlan, defaultMemoryTypeForLayer } from "./moryCore.js";
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
  assert.equal(first.namespace, "owner:owner");
  assert.equal(first.lowConfidencePath, true);
});

test("a shareOwner:false scope keeps unstructured memory in its own chat namespace", () => {
  // The owner-wide default (above) would write somewhere this scope has opted
  // out of reading — `promptMemoryNamespaces` skips owner when shareOwner is
  // false — so it must stay chat-scoped and remain readable by its writer.
  const isolated = { ...scope, shareOwner: false };
  const plan = buildMoryWritePlan(isolated, { content: "只属于本会话" }, "只属于本会话", "long_term", "2026-07-11T10:00:00.000Z");
  assert.equal(plan.namespace, "chat:momo:web:chat-1");
  assert.equal(promptMemoryNamespaces(isolated).includes(plan.namespace), true);
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

/**
 * The defect behind prd.md §3.49, as a guard.
 *
 * `memoryTypes` and `pathPrefixes` are a hard SQL filter in `moryRetrieval`
 * (`storage.list(namespace, { memoryTypes, pathPrefixes })`), not a ranking
 * hint — a row outside them never enters the candidate pool, so no amount of
 * lexical or semantic relevance can surface it. The `memory` tool's `add`
 * action sends neither `type` nor `subject`, so the *default* write type is
 * what almost every conversational memory gets. When that default was `task`
 * and the `chat` intent asked for `user_preference | user_fact | event`, saving
 * and recalling a memory in conversation were disjoint by construction — and
 * both halves reported success.
 *
 * So the two defaults are asserted against each other rather than described.
 */
test("the default write type is retrievable by the plan an ordinary turn uses", () => {
  const chatPlan = buildRetrievalPlan("推荐一款下午提神的饮品");
  assert.equal(chatPlan.intent, "chat");

  for (const layer of ["long_term", "daily"] as const) {
    const type = defaultMemoryTypeForLayer(layer);
    assert.equal(
      chatPlan.memoryTypes.includes(type),
      true,
      `an unstructured ${layer} memory is written as "${type}", which the chat plan does not retrieve`
    );
  }
});

/**
 * The path is filtered next to the type, so a plan whose two fields disagree is
 * unreachable under `pathPrefixes` even when the type matches. The old code
 * hard-coded `mory://task/…` while deriving the type separately, which is
 * exactly how the two drifted apart.
 */
test("an unstructured write's path prefix matches its own type", () => {
  const chatPlan = buildRetrievalPlan("推荐一款下午提神的饮品");
  for (const layer of ["long_term", "daily"] as const) {
    const plan = buildMoryWritePlan(scope, { content: "不喝咖啡" }, "不喝咖啡", layer, "2026-08-09T01:57:19.575Z");
    assert.equal(plan.path.startsWith(`mory://${plan.type}/`), true, `path ${plan.path} does not match type ${plan.type}`);
    assert.equal(
      chatPlan.pathPrefixes.some((prefix) => plan.path.startsWith(prefix)),
      true,
      `path ${plan.path} is outside every chat-intent prefix`
    );
  }
});

/** A daily memory still sorts by date, which the path carries. */
test("a daily memory keeps its date in the path", () => {
  const plan = buildMoryWritePlan(scope, { content: "今天去了医院" }, "今天去了医院", "daily", "2026-08-09T01:57:19.575Z");
  assert.equal(plan.type, "event");
  assert.equal(plan.path.startsWith("mory://event/2026-08-09."), true, plan.path);
});

/** An explicit type from a structured caller still wins over the default. */
test("an explicit type is never overridden by the default", () => {
  const plan = buildMoryWritePlan(
    scope,
    { content: "部署脚本在 bin/", type: "skill", subject: "deploy" },
    "部署脚本在 bin/",
    "long_term",
    "2026-08-09T01:57:19.575Z"
  );
  assert.equal(plan.type, "skill");
  assert.equal(plan.path, "mory://skill/deploy");
});
