import test from "node:test";
import assert from "node:assert/strict";

import {
  cjkBigrams,
  jaccardLexicalSimilarity,
  normalizeForMatch,
  overlapLexicalSimilarity,
  scoreLexical,
  tokenizeWords,
} from "../src/index.js";

test("scoreLexical: Chinese query hits Chinese content (word/bigram channel)", () => {
  const score = scoreLexical("主人喜欢短版回复", "短版");
  assert.ok(score > 0, `expected positive score, got ${score}`);
});

test("scoreLexical: unknown words are recovered by the bigram channel", () => {
  assert.ok(cjkBigrams("调研").includes("调研"));
  const score = scoreLexical("主人又让我调研一家看起来很有潜力的公司", "调研");
  assert.ok(score > 0, `expected positive score, got ${score}`);
});

test("scoreLexical: irrelevant content scores zero", () => {
  assert.equal(scoreLexical("今天天气不错", "短版"), 0);
});

test("scoreLexical: relevant content outranks irrelevant content", () => {
  const hit = scoreLexical("主人喜欢短版回复", "帮我把结论改成短版");
  const miss = scoreLexical("今天天气不错", "帮我把结论改成短版");
  assert.ok(hit > miss);
});

test("scoreLexical: pure function-word query matches nothing", () => {
  assert.equal(scoreLexical("主人喜欢短版回复", "的了吧"), 0);
  assert.equal(scoreLexical("的了吧也在这那", "的了吧"), 0);
});

test("scoreLexical: empty query is listing mode (matches all)", () => {
  assert.equal(scoreLexical("任意内容", ""), 1);
  assert.equal(scoreLexical("任意内容", "   "), 1);
});

test("scoreLexical: mixed Chinese/English query does not regress", () => {
  const score = scoreLexical("主人喜欢用 python 写脚本", "python 脚本");
  assert.ok(score > 0.5, `expected strong match, got ${score}`);
  assert.equal(scoreLexical("主人喜欢用 rust 写工具", "python"), 0);
});

test("scoreLexical: English multi-word query still works", () => {
  const score = scoreLexical("user prefers concise answers", "concise answers");
  assert.ok(score > 0.5, `expected strong match, got ${score}`);
});

test("tokenizeWords: uses Jieba search mode and strips stopwords", () => {
  const tokens = tokenizeWords("上个月主人又让我调研一家很有潜力的公司");
  assert.ok(tokens.includes("上个月"));
  assert.ok(tokens.includes("主人"));
  assert.ok(tokens.includes("公司"));
  assert.ok(!tokens.includes("的"));
  assert.ok(!tokens.includes("我"));
});

test("cjkBigrams: skips pure function-char pairs and non-CJK runs", () => {
  assert.deepEqual(cjkBigrams("的了"), []);
  assert.ok(cjkBigrams("短版 abc 调研").includes("短版"));
  assert.ok(!cjkBigrams("短版 abc 调研").includes("版调"));
});

test("normalizeForMatch: lowercases and collapses whitespace", () => {
  assert.equal(normalizeForMatch("  Hello   World  "), "hello world");
});

test("shared similarity uses the same CJK bigram channel", () => {
  assert.ok(jaccardLexicalSimilarity("主人偏好短版回复", "短版回复") > 0);
  assert.ok(overlapLexicalSimilarity("需要调研公司", "调研") > 0);
  assert.equal(overlapLexicalSimilarity("今天天气", "短版回复"), 0);
});
