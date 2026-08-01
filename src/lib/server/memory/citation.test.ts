import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryCitationStreamFilter,
  formatMemoryShortId,
  stripMemoryCitations
} from "$lib/server/memory/citation.js";

test("stripMemoryCitations removes markers and collects short ids", () => {
  const input = "现在是 2026-08-01。\n\n[[mem:M1,M3]]";
  const result = stripMemoryCitations(input);
  assert.equal(result.text, "现在是 2026-08-01。");
  assert.deepEqual(result.shortIds, ["M1", "M3"]);
});

test("stripMemoryCitations keeps text without markers untouched", () => {
  const result = stripMemoryCitations("plain answer with [brackets] and [[double]] text");
  assert.equal(result.text, "plain answer with [brackets] and [[double]] text");
  assert.deepEqual(result.shortIds, []);
});

test("stripMemoryCitations handles mid-text markers, duplicates, and junk ids", () => {
  const result = stripMemoryCitations("a [[mem:M2]] b [[mem:m2, M5, nope]] c");
  assert.deepEqual(result.shortIds, ["M2", "M5"]);
  assert.ok(!result.text.includes("[[mem"));
});

test("formatMemoryShortId numbers from M1", () => {
  assert.equal(formatMemoryShortId(1), "M1");
  assert.equal(formatMemoryShortId(12), "M12");
});

test("stream filter swallows a marker split across deltas and never leaks it", () => {
  const filter = createMemoryCitationStreamFilter();
  let output = "";
  for (const delta of ["答案在这", "里。\n[[me", "m:M1,", "M4]]"]) {
    output += filter.push(delta);
  }
  output += filter.flush();
  assert.ok(!output.includes("[[mem"), `marker leaked: ${output}`);
  assert.deepEqual(filter.citedShortIds(), ["M1", "M4"]);
  assert.equal(output, "答案在这里。\n");
});

test("stream filter releases lookalike text that is not a marker", () => {
  const filter = createMemoryCitationStreamFilter();
  let output = "";
  for (const delta of ["数组写作 [[1, 2]]，", "而 [[mem", "ory]] 不是标记"]) {
    output += filter.push(delta);
  }
  output += filter.flush();
  assert.equal(output, "数组写作 [[1, 2]]，而 [[memory]] 不是标记");
  assert.deepEqual(filter.citedShortIds(), []);
});

test("stream filter releases an incomplete marker tail at flush", () => {
  const filter = createMemoryCitationStreamFilter();
  const output = filter.push("结尾悬空 [[mem:M9") + filter.flush();
  assert.equal(output, "结尾悬空 [[mem:M9");
  assert.deepEqual(filter.citedShortIds(), []);
});
