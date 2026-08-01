import test from "node:test";
import assert from "node:assert/strict";
import { classifyAutoMemoryCandidate, selectPromptMemoryRows } from "$lib/server/memory/classifier.js";
import type { MemoryRecord } from "$lib/server/memory/types.js";

function record(id: string, content: string, tags: string[] = ["class:general"]): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id,
    channel: "web",
    externalUserId: "u1",
    content,
    tags,
    layer: "long_term",
    state: "active",
    version: 1,
    accessCount: 0,
    injectionCount: 0,
    createdAt: now,
    updatedAt: now
  };
}

test("selectPromptMemoryRows: Chinese query ranks matching memory first", () => {
  const rows = [
    record("a", "主人常用的编辑器是 neovim"),
    record("b", "主人喜欢短版回复"),
    record("c", "今天天气不错")
  ];
  const { longTerm } = selectPromptMemoryRows(rows, "帮我把这份总结改成短版", 2);
  assert.equal(longTerm[0]?.id, "b");
});

test("selectPromptMemoryRows: class weights still dominate over weak lexical hits", () => {
  const rows = [
    record("pref", "回复时使用中文，聊聊都可以", ["class:user_preference"]),
    record("gen", "主人提到过随便聊聊这个词", ["class:general"])
  ];
  const { longTerm } = selectPromptMemoryRows(rows, "随便聊聊", 2);
  assert.equal(longTerm[0]?.id, "pref");
});

test("selectPromptMemoryRows: zero lexical relevance injects nothing (relevance floor)", () => {
  const rows = [
    record("pref", "回复时使用中文", ["class:user_preference"]),
    record("proj", "正在开发一个桌面应用", ["class:project"]),
    record("fact", "体重目标 66.80~67.00kg", ["class:user_profile"])
  ];
  const { longTerm, daily } = selectPromptMemoryRows(rows, "现在几点", 5);
  assert.deepEqual(longTerm, []);
  assert.deepEqual(daily, []);
});

test("selectPromptMemoryRows: low utility from feedback pushes a memory down the ranking", () => {
  const liked = { ...record("liked", "主人喜欢短版回复", ["class:general"]), utility: 0.9 };
  const disliked = { ...record("disliked", "主人喜欢短版格式的清单", ["class:general"]), utility: 0.1 };
  const { longTerm } = selectPromptMemoryRows([disliked, liked], "帮我把这份总结改成短版", 2);
  assert.equal(longTerm[0]?.id, "liked");
});

test("per-message auto extraction only accepts explicit remember intent", () => {
  assert.equal(classifyAutoMemoryCandidate("我偏好简短直接的回答方式"), null);
  assert.ok(classifyAutoMemoryCandidate("请记住我偏好简短直接的回答方式"));
});
