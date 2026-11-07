import assert from "node:assert/strict";
import test from "node:test";
import { getKanbanReceiptToolDefinition } from "./kanbanReceipt.js";
import type { ToolExecutionContext } from "./toolTypes.js";

function contextWith(submitted: unknown[]): ToolExecutionContext {
  return {
    submitKanbanReceipt: async (actions: unknown) => {
      submitted.push(actions);
      return { ok: true, receiptId: "receipt-1", recorded: true };
    }
  } as ToolExecutionContext;
}

test("kanban_receipt normalizes a full receipt and forwards it to the task hook", async () => {
  const submitted: unknown[] = [];
  const tool = getKanbanReceiptToolDefinition();
  const result = await tool.handler({
    conclusion: " 完成 ",
    evidence: ["weekly.md"],
    continueWork: true,
    question: "",
    verifyAt: "  ",
    checklist: [{ text: "收集数据", done: true }]
  }, contextWith(submitted));
  assert.equal(result.ok, true);
  assert.deepEqual(submitted, [{
    conclusion: "完成",
    evidence: ["weekly.md"],
    continueWork: true,
    checklist: [{ text: "收集数据", done: true }]
  }]);
  assert.equal((result.metadata as { receiptId?: string }).receiptId, "receipt-1");
});

test("kanban_receipt rejects empty receipts and works only inside a kanban attempt", async () => {
  const tool = getKanbanReceiptToolDefinition();
  const empty = await tool.handler({ conclusion: "   " }, contextWith([]));
  assert.equal(empty.ok, false);
  assert.match(empty.error ?? "", /empty/i);

  const outside = await tool.handler({ conclusion: "done" }, {} as ToolExecutionContext);
  assert.equal(outside.ok, false);
  assert.match(outside.error ?? "", /unavailable outside a Kanban Task/);

  const failed = await tool.handler({ continueWork: true }, {
    submitKanbanReceipt: async () => ({ ok: false, error: "lease lost" })
  } as ToolExecutionContext);
  assert.equal(failed.ok, false);
  assert.match(failed.error ?? "", /lease lost/);
});
