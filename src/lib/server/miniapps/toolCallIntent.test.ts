import assert from "node:assert/strict";
import test from "node:test";
import {
  describesUncalledMiniAppTool,
  describesPseudoToolCall,
  recoverMiniAppResultText
} from "./toolCallIntent.js";

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

const EXPENSE_IDS = ["miniapp__expense-tracker__add", "miniapp__expense-tracker__list"];

test("recognizes a pseudo-call shipped as the closing reply", () => {
  // The shape actually observed from grok-4.5 after a successful add.
  assert.equal(
    describesPseudoToolCall(
      "run tool miniapp__expense-tracker__add with amount is 20 category is food note is 买肉 type is expense",
      EXPENSE_IDS
    ),
    "miniapp__expense-tracker__add"
  );
  assert.equal(
    describesPseudoToolCall("miniapp__todo__add with title is 写文档", TOOL_IDS),
    "miniapp__todo__add"
  );
  assert.equal(describesPseudoToolCall("调用 todo.add 来添加", TOOL_IDS), "miniapp__todo__add");
  assert.equal(describesPseudoToolCall("todo.add({title: 'x'})", TOOL_IDS), "miniapp__todo__add");
});

test("a genuine report is not a pseudo-call, even when it names the tool", () => {
  assert.equal(describesPseudoToolCall("已记账：餐饮 −20.00 元（备注：买肉）。", EXPENSE_IDS), null);
  assert.equal(describesPseudoToolCall("已经帮你加到 todo 列表了。", TOOL_IDS), null);
  // Mentioning the id while reporting is clumsy but is not an invocation.
  assert.equal(
    describesPseudoToolCall("The miniapp__todo__add step succeeded and the task is saved.", TOOL_IDS),
    null
  );
  assert.equal(describesPseudoToolCall("", TOOL_IDS), null);
  assert.equal(describesPseudoToolCall("run tool miniapp__todo__add", []), null);
});

test("recovers the reply from the last successful Mini App tool result", () => {
  const attempt = [
    { role: "assistant", content: [{ type: "toolCall", name: "miniapp__expense-tracker__add" }] },
    {
      role: "toolResult",
      toolName: "miniapp__expense-tracker__add",
      isError: false,
      content: [{ type: "text", text: "已记账：餐饮 −20.00 元（2026-08-02，备注：买肉）" }]
    },
    { role: "assistant", content: [{ type: "text", text: "run tool ..." }] }
  ];
  assert.equal(
    recoverMiniAppResultText(attempt, EXPENSE_IDS),
    "已记账：餐饮 −20.00 元（2026-08-02，备注：买肉）"
  );
});

test("recovery skips failed results, foreign tools, and empty text", () => {
  const withFailure = [
    {
      role: "toolResult",
      toolName: "miniapp__expense-tracker__add",
      isError: false,
      content: [{ type: "text", text: "已记账：餐饮 −20.00 元" }]
    },
    {
      role: "toolResult",
      toolName: "miniapp__expense-tracker__list",
      isError: true,
      content: [{ type: "text", text: "list failed" }]
    }
  ];
  assert.equal(recoverMiniAppResultText(withFailure, EXPENSE_IDS), "已记账：餐饮 −20.00 元");

  const foreign = [
    { role: "toolResult", toolName: "bash", isError: false, content: [{ type: "text", text: "ok" }] }
  ];
  assert.equal(recoverMiniAppResultText(foreign, EXPENSE_IDS), null);
  assert.equal(recoverMiniAppResultText([], EXPENSE_IDS), null);
  assert.equal(
    recoverMiniAppResultText(
      [{ role: "toolResult", toolName: "miniapp__expense-tracker__add", content: [] }],
      EXPENSE_IDS
    ),
    null
  );
});
