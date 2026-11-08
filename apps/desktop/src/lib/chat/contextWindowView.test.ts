import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextWindowBlocks,
  buildContextRoundUsage,
  buildToolUsageRows,
  estimateContextTextTokens,
  layoutContextWindowBlocks
} from "./contextWindowView";
import type { ComposerContextUsage } from "../presentation";

const usage: ComposerContextUsage = {
  contextWindow: 1_000_000,
  usedTokens: 150_000,
  percent: 15,
  categories: [
    { key: "messages", tokens: 10_000, percent: 6.6 },
    { key: "tools", tokens: 100_000, percent: 66.7 },
    { key: "systemPrompt", tokens: 25_000, percent: 16.6 },
    { key: "skills", tokens: 15_000, percent: 10 }
  ],
  counted: false
};

test("context blocks scale estimates to reported usage and keep remaining space", () => {
  const blocks = buildContextWindowBlocks(usage);
  const tools = blocks.find((block) => block.key === "tools");
  const remaining = blocks.find((block) => block.key === "remaining");
  assert.equal(blocks.filter((block) => block.key === "tools").length, 1);
  assert.equal(tools?.tokens, 100_000);
  assert.equal(remaining?.tokens, 850_000);
  assert.equal(Math.abs((remaining?.percent ?? 0) - 85) < 0.0001, true);
});

test("live context adds to the previous window and reduces remaining space", () => {
  for (const categories of [usage.categories, []]) {
    const current = { ...usage, categories, contextWindow: 100_000, usedTokens: 80_000, percent: 80 };
    for (const live of [10_000, 30_000]) {
      const blocks = buildContextWindowBlocks(current, live);
      const used = blocks.filter(block => block.key !== "remaining").reduce((sum, block) => sum + block.tokens, 0);
      assert.equal(used, current.usedTokens + live);
      assert.equal(blocks.find(block => block.key === "live")?.tokens, live);
      assert.equal(blocks.find(block => block.key === "remaining")?.tokens ?? 0, Math.max(0, current.contextWindow - used));
    }
  }
});

test("context treemap geometry stays normalized and zooms small sessions readable", () => {
  const blocks = buildContextWindowBlocks(usage);
  const rects = layoutContextWindowBlocks(blocks);
  assert.equal(rects.length, 5);
  assert.equal(Math.round(rects.reduce((total, rect) => total + rect.width * rect.height, 0)), 10_000);
  // Content under 30% of the window is zoomed to hold ~30% of the map
  // (proportions between content blocks preserved, remaining visually absorbs
  // the difference); labels and percent values stay real-token numbers.
  for (const rect of rects) {
    const block = blocks.find((candidate) => candidate.key === rect.key);
    assert.ok(block, `${rect.key} maps back to a block`);
    const expected = (block?.displayTokens ?? 0) / blocks.reduce((total, candidate) => total + candidate.displayTokens, 0) * 10_000;
    const actual = rect.width * rect.height;
    assert.ok(Math.abs(actual - expected) < 12, `${rect.key} area ${actual} vs ${expected}`);
    assert.equal(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0, true);
    assert.equal(rect.x + rect.width <= 100.001, true);
    assert.equal(rect.y + rect.height <= 100.001, true);
  }
  const contentArea = rects
    .filter((rect) => rect.key !== "remaining")
    .reduce((total, rect) => total + rect.width * rect.height, 0);
  assert.ok(Math.abs(contentArea - 3_000) < 40, `content area ${contentArea} should be ~30% of the map`);
});

test("calibrated categories pass through without rescaling", () => {
  const counted: ComposerContextUsage = {
    ...usage,
    usedTokens: 150_000,
    counted: true,
    categories: [
      { key: "systemPrompt", tokens: 15_300, percent: 10.2 },
      { key: "memory", tokens: 4_400, percent: 2.9 },
      { key: "files", tokens: 39_800, percent: 26.5 },
      { key: "toolResults", tokens: 34_400, percent: 22.9 },
      { key: "messages", tokens: 56_100, percent: 37.4 }
    ]
  };
  const blocks = buildContextWindowBlocks(counted);
  for (const category of counted.categories) {
    const block = blocks.find((candidate) => candidate.key === category.key);
    assert.equal(block?.tokens, category.tokens, `${category.key} survives calibration verbatim`);
  }
  assert.equal(blocks.some((block) => block.key === "memory"), true);
  assert.equal(blocks.some((block) => block.key === "files"), true);
  assert.equal(blocks.find((block) => block.key === "remaining")?.tokens, 850_000);
});

test("context rounds split recent turns and fold earlier turns", () => {
  const rounds = Array.from({ length: 12 }, (_, index) => ({
    index: index + 1,
    textTokens: 1_000,
    toolTokens: index === 11 ? 8_000 : 0,
    ...(index === 11 ? { reportedTokens: 438_700 } : {})
  }));
  const blocks = buildContextWindowBlocks(usage, 0, rounds);
  assert.equal(blocks.some((block) => block.key === "olderRounds"), true);
  assert.equal(blocks.some((block) => block.key === "round:9"), true);
  assert.equal(blocks.some((block) => block.key === "round:12"), true);
  assert.equal(blocks.some((block) => block.key === "round:1"), false);
  assert.equal(blocks.find((block) => block.key === "toolResults")?.tokens, 4_000);
  assert.equal(blocks.find((block) => block.key === "round:12")?.reportedTokens, 438_700);
  const messageTokens = blocks
    .filter((block) => block.key === "olderRounds" || block.key.startsWith("round:"))
    .reduce((total, block) => total + block.tokens, 0);
  assert.equal(messageTokens, 6_000);
});

test("round usage estimates transcript turns and live tool results", () => {
  const rounds = buildContextRoundUsage(
    [
      { role: "user", content: "abcd" },
      { role: "assistant", content: "中文", usage: { inputTokens: 6_500, outputTokens: 1_200, cacheReadTokens: 431_000, cacheWriteTokens: 0, totalTokens: 438_700 }, activities: [{ key: "1", kind: "tool", tool: "bash", label: "bash", state: "success", summary: "abcd" }] },
      { role: "user", content: "hello" }
    ],
    [{ key: "2", kind: "tool", tool: "read", label: "read", state: "running", tokenUsage: 25 }]
  );
  assert.deepEqual(rounds, [
    { index: 1, textTokens: 3, toolTokens: 1, reportedTokens: 438_700 },
    { index: 2, textTokens: 2, toolTokens: 25 }
  ]);
});

test("round usage keeps provider-ledger turns even without estimable text", () => {
  const rounds = buildContextRoundUsage([
    { role: "user", content: "" },
    { role: "assistant", content: "", usage: { inputTokens: 6_500, outputTokens: 1_200, cacheReadTokens: 431_000 } }
  ]);
  assert.deepEqual(rounds, [{ index: 1, textTokens: 0, toolTokens: 0, reportedTokens: 438_700 }]);
});

test("tool rows group repeats and estimate CJK-aware result text", () => {
  assert.equal(estimateContextTextTokens("abcd"), 1);
  assert.equal(estimateContextTextTokens("中文"), 2);
  const rows = buildToolUsageRows([
    { key: "1", kind: "tool", tool: "exec_command", label: "exec", state: "success", tokenUsage: 80_000 },
    { key: "2", kind: "tool", tool: "exec_command", label: "exec", state: "running", summary: "中文结果" }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].tokens, 80_004);
  assert.equal(rows[0].running, true);
});
