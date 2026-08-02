import assert from "node:assert/strict";
import test from "node:test";
import { describesUncalledMiniAppTool } from "./toolCallIntent.js";

const TOOL_IDS = ["miniapp__todo__add", "miniapp__todo__list", "miniapp__todo__complete"];

test("recognizes a fully qualified tool id named in prose", () => {
  assert.equal(
    describesUncalledMiniAppTool(
      "run miniapp__todo__add with title is 写一个 Agent 和 SKILL 来描述如何写小程序",
      TOOL_IDS
    ),
    "miniapp__todo__add"
  );
});

test("recognizes shorthand app/tool pairs", () => {
  assert.equal(describesUncalledMiniAppTool("I will call todo.add now", TOOL_IDS), "miniapp__todo__add");
  assert.equal(describesUncalledMiniAppTool("calling todo__list", TOOL_IDS), "miniapp__todo__list");
});

test("ordinary prose about the app is not an uncalled tool", () => {
  assert.equal(describesUncalledMiniAppTool("你的 todo 列表里目前没有未完成的任务。", TOOL_IDS), null);
  assert.equal(describesUncalledMiniAppTool("I added it to your todo list.", TOOL_IDS), null);
  assert.equal(describesUncalledMiniAppTool("", TOOL_IDS), null);
  assert.equal(describesUncalledMiniAppTool("anything", []), null);
});
