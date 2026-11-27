import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { translator } from "../i18n";
import {
  HOME_AWAY_THRESHOLD_MS,
  type HomeBriefInput,
  type HomePresenceInput,
  MOMO_EXPRESSIONS,
  MOMO_SHAPES,
  homeAwayMs,
  homeBrief,
  homeGreeting,
  homeMood,
  momoExpressionFor,
  momoExpressionSrc
} from "./homePresence";

const zh = translator("zh-CN");
const en = translator("en");
const hour = 3_600_000;

const base: HomePresenceInput = {
  enabled: true,
  activityStatus: "idle",
  stale: false,
  decisionCount: 0,
  doneCount: 0,
  failedCount: 0,
  sessionCount: 3,
  hour: 15
};

function mood(override: Partial<HomePresenceInput> = {}) {
  return homeMood({ ...base, ...override });
}

function brief(override: Partial<HomeBriefInput> = {}, copy = zh) {
  return homeBrief(
    { ...base, name: "Momo", description: "", awayMs: null, liveSummary: "", ...override },
    copy
  );
}

test("the mood follows the most urgent real signal", () => {
  assert.equal(mood({ enabled: false, decisionCount: 2 }), "disabled");
  // Only the owner can unblock a decision, so it outranks a running task.
  assert.equal(mood({ decisionCount: 1, activityStatus: "working" }), "alert");
  assert.equal(mood({ activityStatus: "working" }), "working");
  assert.equal(mood({ stale: true }), "error");
  assert.equal(mood({ activityStatus: "error" }), "error");
  assert.equal(mood({ doneCount: 2 }), "done");
  assert.equal(mood({ failedCount: 1 }), "error");
  // A run that finished but was already read does not keep the finisher pose.
  assert.equal(mood({ activityStatus: "completed" }), "idle");
  assert.equal(mood({ hour: 23 }), "sleeping");
  assert.equal(mood({ hour: 5 }), "sleeping");
  assert.equal(mood({ hour: 2, sessionCount: 0 }), "sleeping");
  assert.equal(mood({ hour: 10, sessionCount: 0 }), "welcome");
  assert.equal(mood(), "idle");
});

test("every mood resolves to an exported expression with a known shape", () => {
  const moods = ["disabled", "alert", "working", "error", "done", "sleeping", "welcome", "idle"] as const;
  for (const value of moods) {
    const expression = momoExpressionFor(value);
    assert.ok(MOMO_EXPRESSIONS.includes(expression), `${value} has no expression`);
    assert.ok(MOMO_SHAPES[expression], `${expression} has no shape`);
    assert.ok(existsSync(new URL(`../../../public/momo/${expression}.webp`, import.meta.url)), `${expression} is not exported`);
  }
  assert.equal(momoExpressionSrc("happy"), "/momo/happy.webp");
});

test("the hello follows the local clock", () => {
  const expected = { 0: "night", 5: "night", 6: "morning", 10: "morning", 11: "noon", 12: "noon", 13: "afternoon", 17: "afternoon", 18: "evening", 21: "evening", 22: "night", 24: "night" } as const;
  for (const [clock, greeting] of Object.entries(expected)) assert.equal(homeGreeting(Number(clock)), greeting);
  assert.equal(brief({ hour: 15 }).hello, "下午好");
  assert.equal(brief({ hour: 15 }, en).hello, "Good afternoon");
  assert.equal(brief({ hour: 23 }, en).hello, "It's late");
});

test("a first meeting introduces the Agent by name", () => {
  assert.equal(brief({ sessionCount: 0, hour: 10, name: "Momo" }).hello, "你好，我是 Momo");
  assert.equal(brief({ sessionCount: 0, hour: 23, name: "Momo" }, en).hello, "Hi, I'm Momo");
});

test("only a long gap counts as time away", () => {
  const now = Date.parse("2026-11-26T10:00:00Z");
  assert.equal(homeAwayMs(new Date(now - HOME_AWAY_THRESHOLD_MS).toISOString(), now), HOME_AWAY_THRESHOLD_MS);
  assert.equal(homeAwayMs(new Date(now - HOME_AWAY_THRESHOLD_MS + 60_000).toISOString(), now), null);
  assert.equal(homeAwayMs(undefined, now), null);
  assert.equal(homeAwayMs("not a date", now), null);
  assert.equal(homeAwayMs(new Date(now + hour).toISOString(), now), null);
});

test("the sentence counts exactly what is waiting below the composer", () => {
  assert.equal(
    brief({ decisionCount: 2, doneCount: 3, failedCount: 1, awayMs: 6 * hour }).say,
    "你离开了 6 小时，我办完了 3 件事，有 2 件事等你拍板。其中 1 件事没办成。"
  );
  assert.equal(brief({ decisionCount: 1 }).say, "有 1 件事等你拍板。");
  assert.equal(brief({ doneCount: 2 }).say, "刚办好了 2 件事，放在下面。");
  assert.equal(brief({ failedCount: 1 }).say, "1 件事没办成。");
  assert.equal(brief({ awayMs: 50 * hour, doneCount: 1 }).say, "你离开了 2 天，刚办好了 1 件事，放在下面。");
});

test("English sentences agree in number", () => {
  assert.equal(brief({ decisionCount: 1, doneCount: 1, failedCount: 1 }, en).say, "I finished 1 thing, and 1 thing needs your decision. 1 thing didn't finish.");
  assert.equal(brief({ decisionCount: 2, doneCount: 3 }, en).say, "I finished 3 things, and 2 things need your decision.");
  assert.equal(brief({ doneCount: 2 }, en).say, "I just finished 2 things for you.");
  assert.equal(brief({ awayMs: 6 * hour, decisionCount: 2 }, en).say, "You were away for 6 h. 2 things need your decision.");
});

test("a quiet desk falls back to the Agent's own words, and live states speak for themselves", () => {
  assert.equal(brief().say, zh.homeGreeting);
  assert.equal(brief({ description: "负责周报和发票" }).say, "负责周报和发票");
  assert.equal(brief({ activityStatus: "working", liveSummary: "整理周报 · 2 分" }).say, "整理周报 · 2 分");
  assert.equal(brief({ stale: true, awayMs: 4 * hour, description: "负责周报" }).say, "你离开了 4 小时。负责周报");
  assert.equal(brief({ awayMs: 4 * hour }).say, "你离开了 4 小时。" + zh.homeGreeting);
  assert.equal(brief({ activityStatus: "working", decisionCount: 1, liveSummary: "整理周报 · 2 分" }).say, "整理周报 · 2 分 · 有 1 件事等你拍板。");
  assert.equal(brief({ activityStatus: "working", liveSummary: "整理周报 · 2 分", awayMs: 4 * hour }).say, "你离开了 4 小时。整理周报 · 2 分");
  // Offline, the sentence keeps counting what is still listed below it.
  assert.equal(brief({ stale: true, decisionCount: 2 }).say, "有 2 件事等你拍板。");
});
