import test from "node:test";
import assert from "node:assert/strict";

import { inferRetrievalIntent, buildRetrievalPlan } from "../src/index.js";

test("inferRetrievalIntent classifies work queries", () => {
  assert.equal(inferRetrievalIntent("继续推进 project A 的任务"), "work");
});

test("buildRetrievalPlan for work includes task and skill prefixes", () => {
  const plan = buildRetrievalPlan("debug 项目部署问题");
  assert.equal(plan.intent, "work");
  assert.ok(plan.pathPrefixes.some((p) => p.startsWith("mory://task/")));
  assert.ok(plan.pathPrefixes.some((p) => p.startsWith("mory://skill/")));
  assert.ok(plan.topK >= 8);
});

test("buildRetrievalPlan for profile focuses on preference/fact", () => {
  const plan = buildRetrievalPlan("我喜欢什么回答风格？");
  assert.equal(plan.intent, "profile");
  assert.deepEqual(plan.memoryTypes.slice(0, 2), ["user_preference", "user_fact"]);
});
