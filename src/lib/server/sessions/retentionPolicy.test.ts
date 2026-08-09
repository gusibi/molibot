import test from "node:test";
import assert from "node:assert/strict";
import { classifyTurnRetention, retentionCapabilities } from "./retentionPolicy.js";

test("explicit Chinese retention instructions map to one canonical policy", () => {
  assert.equal(classifyTurnRetention("这个验证码仅本轮使用：TMP-4821"), "turn_only");
  assert.equal(classifyTurnRetention("这是我的偏好，但不要记住"), "no_memory");
  assert.equal(classifyTurnRetention("这段内容不可搜索"), "not_searchable");
  assert.equal(classifyTurnRetention("请记住我喜欢乌龙茶"), "standard");
});

test("stronger retention instructions win when phrases overlap", () => {
  assert.equal(classifyTurnRetention("只在这次对话中使用，不要记住这个编号"), "turn_only");
  assert.equal(classifyTurnRetention("不要记忆，也不要让它被搜索到"), "not_searchable");
});

test("discussing retention vocabulary does not silently apply it", () => {
  assert.equal(classifyTurnRetention("请解释仅本轮和不记忆有什么区别"), "standard");
  assert.equal(classifyTurnRetention("不可搜索是什么意思？"), "standard");
});

test("canonical policies expose independent context, search and memory capabilities", () => {
  assert.deepEqual(retentionCapabilities("standard"), { futureContext: true, searchable: true, memoryEligible: true });
  assert.deepEqual(retentionCapabilities("no_memory"), { futureContext: true, searchable: true, memoryEligible: false });
  assert.deepEqual(retentionCapabilities("not_searchable"), { futureContext: true, searchable: false, memoryEligible: false });
  assert.deepEqual(retentionCapabilities("turn_only"), { futureContext: false, searchable: false, memoryEligible: false });
});
