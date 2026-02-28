import test from "node:test";
import assert from "node:assert/strict";

import {
  MoryEngine,
  InMemoryStorageAdapter,
  createSqliteStorageAdapter,
  createReadMemoryTool,
  applyForgettingPolicy,
} from "../src/index.js";

test("moryEngine commit/retrieve/read/forget full loop", async () => {
  const storage = new InMemoryStorageAdapter();
  const engine = new MoryEngine({
    storage,
    extractor: async () => ({
      memories: [
        {
          type: "user_preference",
          subject: "language",
          value: "用户偏好中文回答",
          confidence: 0.93,
          updatedPolicy: "overwrite",
          title: "中文偏好",
        },
        {
          type: "task",
          subject: "project.alpha",
          value: "正在实现 mory 引擎",
          confidence: 0.86,
          updatedPolicy: "merge_append",
          title: "当前任务",
        },
      ],
    }),
    embedder: async (text: string) => {
      const a = text.length % 7;
      const b = text.length % 11;
      const c = text.length % 13;
      return [a / 7, b / 11, c / 13];
    },
  });

  await engine.init();

  const commit1 = await engine.commit({
    userId: "u1",
    dialogue: "用户说以后请用中文，并且当前在做 mory 引擎开发",
    source: "session-1",
    observedAt: "2026-02-27T00:00:00.000Z",
  });

  assert.equal(commit1.accepted, 2);
  assert.equal(commit1.skipped, 0);

  const commit2 = await engine.commit({
    userId: "u1",
    extracted: {
      memories: [
        {
          path: "mory://user_preference/language",
          type: "user_preference",
          subject: "language",
          value: "用户现在更喜欢英文回答",
          confidence: 0.95,
          updatedPolicy: "overwrite",
          title: "英文偏好",
        },
      ],
    },
    source: "session-2",
    observedAt: "2026-02-28T00:00:00.000Z",
  });

  assert.equal(commit2.accepted, 1);

  const readTool = createReadMemoryTool(engine, "u1");
  const read = await readTool("/profile/preferences/language");
  assert.equal(read.path, "mory://user_preference/language");
  assert.ok(read.records.length >= 1);
  assert.match(read.records[0], /value:/);

  const retrieval = await engine.retrieve("u1", "我现在喜欢什么语言回答？", {
    topK: 5,
  });
  assert.ok(retrieval.hits.length >= 1);
  assert.ok(retrieval.promptContext.includes("[L0 Memory Index]"));

  const forgetPlan = await applyForgettingPolicy(storage, "u1", {
    capacity: 1,
    minRetentionScore: 0.2,
  });
  assert.equal(forgetPlan.keep.length, 1);
  assert.ok(forgetPlan.archive.length >= 1);

  const metrics = engine.getMetrics();
  assert.ok(metrics.writesInserted + metrics.writesUpdated >= 2);
  assert.ok(metrics.retrievalRequests >= 1);
});

test("sqlite adapter persists embeddings and supports local vectorSearch", async () => {
  const storage = createSqliteStorageAdapter(":memory:");
  const engine = new MoryEngine({
    storage,
    embedder: async (text: string) => {
      if (text.includes("中文")) return [1, 0, 0];
      if (text.includes("英文")) return [0, 1, 0];
      return [0, 0, 1];
    },
  });

  await engine.init();
  await engine.ingest({
    userId: "u-sqlite",
    memory: {
      path: "mory://user_preference/language",
      type: "user_preference",
      subject: "language",
      value: "用户偏好中文回答",
      confidence: 0.91,
      updatedPolicy: "overwrite",
    },
  });

  const rows = await storage.readByPath("u-sqlite", "mory://user_preference/language");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].embedding, [1, 0, 0]);

  const hits = await storage.vectorSearch("u-sqlite", {
    vector: [1, 0, 0],
    topK: 1,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].node.path, "mory://user_preference/language");
});
