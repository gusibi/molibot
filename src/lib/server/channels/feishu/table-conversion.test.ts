import assert from "node:assert/strict";
import test from "node:test";
import { parseFeishuRichTextSegments } from "./formatting.js";
import { buildFeishuReplyCards } from "./messaging.js";

test("parseFeishuRichTextSegments extracts markdown tables and preserves surrounding text", () => {
  const input = [
    "当前模型列表（共3个）：",
    "",
    "| 编号 | 供应商 | 模型 |",
    "|------|--------|------|",
    "| 1 | Built-in | A |",
    "| 2 ⭐ 当前活跃中 | Grok2Api | B |",
    "",
    "切换模型：",
    "/models 2"
  ].join("\n");

  const segments = parseFeishuRichTextSegments(input);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], {
    type: "markdown",
    content: "当前模型列表（共3个）："
  });
  assert.deepEqual(segments[1], {
    type: "table",
    columns: ["编号", "供应商", "模型"],
    rows: [
      ["1", "Built-in", "A"],
      ["2 ⭐ 当前活跃中", "Grok2Api", "B"]
    ]
  });
  assert.deepEqual(segments[2], {
    type: "markdown",
    content: "切换模型：\n/models 2"
  });
});

test("buildFeishuReplyCards converts markdown table into native feishu table element", () => {
  const input = [
    "当前模型列表（共2个）：",
    "",
    "| 编号 | 供应商 | 模型 |",
    "|------|--------|------|",
    "| 1 | Grok2Api | grok-4.20-auto |",
    "| 2 ⭐ 当前活跃中 | Grok2Api | grok-4.20-fast |"
  ].join("\n");

  const cards = buildFeishuReplyCards(input);
  assert.equal(cards.length, 1);
  const elements = (cards[0] as { elements?: Array<Record<string, unknown>> }).elements ?? [];
  const table = elements.find((item) => item.tag === "table");
  assert.ok(table);
  assert.deepEqual(
    (table as { columns: Array<{ name: string; display_name: string; data_type: string }> }).columns,
    [
      { name: "col_1", display_name: "编号", data_type: "lark_md", width: "auto" },
      { name: "col_2", display_name: "供应商", data_type: "lark_md", width: "auto" },
      { name: "col_3", display_name: "模型", data_type: "lark_md", width: "auto" }
    ]
  );
  assert.deepEqual((table as { rows: Array<Record<string, string>> }).rows, [
    { col_1: "1", col_2: "Grok2Api", col_3: "grok-4.20-auto" },
    { col_1: "2 ⭐ 当前活跃中", col_2: "Grok2Api", col_3: "grok-4.20-fast" }
  ]);
});

test("parseFeishuRichTextSegments keeps markdown tables inside fenced code blocks as markdown", () => {
  const input = [
    "下面是示例：",
    "",
    "```md",
    "| 编号 | 供应商 | 模型 |",
    "|------|--------|------|",
    "| 1 | 示例供应商 | 示例模型 |",
    "```",
    "",
    "结束"
  ].join("\n");

  const segments = parseFeishuRichTextSegments(input);
  assert.deepEqual(segments, [
    {
      type: "markdown",
      content: [
        "下面是示例：",
        "",
        "```md",
        "| 编号 | 供应商 | 模型 |",
        "|------|--------|------|",
        "| 1 | 示例供应商 | 示例模型 |",
        "```",
        "",
        "结束"
      ].join("\n")
    }
  ]);
});
