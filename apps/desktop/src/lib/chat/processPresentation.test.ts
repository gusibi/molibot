import assert from "node:assert/strict";
import test from "node:test";
import { translator } from "../i18n";
import { processPresentation } from "./processPresentation";
import type { TranscriptProcessBlock } from "./transcript";

test("default progress uses assistant commentary, never private thinking or tool payloads", () => {
  const blocks: TranscriptProcessBlock[] = [
    { id: "thinking", kind: "thinking", content: "PRIVATE_REASONING" },
    { id: "a", kind: "text", content: "已抓取原文。" },
    { id: "b", kind: "text", content: "正在整理图片。" },
    { id: "c", kind: "text", content: "准备校验文章。" },
    { id: "tools", kind: "activities", activities: [{ key: "bash", kind: "tool", tool: "bash", label: "校验文章", state: "running", summary: "RAW_LOG", startedAt: "2026-10-08T00:00:00Z" }] }
  ];
  const result = processPresentation(blocks, translator("zh-CN"));
  assert.deepEqual(result.commentary.map(block => block.content), ["正在整理图片。", "准备校验文章。"]);
  assert.equal(result.status, "正在执行命令…");
  assert.equal(result.detail, "校验文章");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING|RAW_LOG/);
});

test("missing commentary gets a localized honest status and ignores terminal tools", () => {
  const blocks: TranscriptProcessBlock[] = [{ id: "tools", kind: "activities", activities: [{ key: "parent", kind: "tool", tool: "subagent", label: "subagent", state: "running" }, { key: "done", kind: "tool", tool: "read", label: "read", state: "success" }] }];
  assert.equal(processPresentation(blocks, translator("en")).status, "A subagent is working on the delegated task…");
  assert.equal(processPresentation([], translator("zh-CN")).status, "正在处理下一步…");
});
