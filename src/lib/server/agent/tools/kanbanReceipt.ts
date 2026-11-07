import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "$lib/server/agent/tools/toolTypes.js";

const kanbanReceiptSchema = Type.Object({
  conclusion: Type.Optional(Type.String({ description: "本轮工作结论（做了什么、发现了什么）。" })),
  evidence: Type.Optional(Type.Array(Type.String(), { description: "支撑结论的证据引用或摘要。" })),
  continueWork: Type.Optional(Type.Boolean({ description: "是否继续下一轮工作。" })),
  handoffToAgentId: Type.Optional(Type.String({ description: "（团队任务）把推进权交给哪位成员。" })),
  handoffBrief: Type.Optional(Type.String({ description: "（团队任务）交给下一位成员的简报：目标、输入、完成要求、已有成果。" })),
  question: Type.Optional(Type.String({ description: "需要用户回答的问题；提问后本轮停下等待。" })),
  questionOptions: Type.Optional(Type.Array(Type.String(), { description: "问题的候选选项（可选）。" })),
  verifyAt: Type.Optional(Type.String({ description: "预约复查时间（ISO 8601），到时唤醒回本任务核对。" })),
  requestCompletion: Type.Optional(Type.Boolean({ description: "申请完成：必须逐项核对完成条件并附证据。" })),
  checklist: Type.Optional(Type.Array(Type.Object({
    itemId: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    done: Type.Optional(Type.Boolean()),
    remove: Type.Optional(Type.Boolean())
  }), { description: "进度清单变更：新增（text）、勾选/取消（itemId 或 text + done）、删除（remove）。" }))
});

export type KanbanReceiptToolInput = {
  conclusion?: string;
  evidence?: string[];
  continueWork?: boolean;
  handoffToAgentId?: string;
  handoffBrief?: string;
  question?: string;
  questionOptions?: string[];
  verifyAt?: string;
  requestCompletion?: boolean;
  checklist?: Array<{ itemId?: string; text?: string; done?: boolean; remove?: boolean }>;
};

/**
 * The task-scoped structured receipt (spec: 回执通过任务作用域的结构化工具提交,
 * 绑定任务、执行轮次与配置版本). Only available inside a Kanban Task attempt.
 */
export function getKanbanReceiptToolDefinition(): ToolDefinition {
  return {
    id: "kanban_receipt",
    name: "kanban_receipt",
    description: "Submit the structured round receipt for the current Kanban Task: conclusion, evidence, and the explicit next step (continue, handoff, question, scheduled review, or request completion). A round without a receipt stops for the user instead of continuing.",
    inputSchema: kanbanReceiptSchema,
    risk: "low",
    source: "builtin",
    effect: "read",
    sideEffectClass: "pure",
    handler: async (input, ctx) => {
      if (!ctx.submitKanbanReceipt) {
        return { ok: false, error: "kanban_receipt is unavailable outside a Kanban Task attempt." };
      }
      const receipt = input as KanbanReceiptToolInput;
      const hasAction = Boolean(
        receipt.conclusion?.trim()
        || receipt.continueWork
        || receipt.handoffToAgentId?.trim()
        || receipt.question?.trim()
        || receipt.verifyAt?.trim()
        || receipt.requestCompletion
        || (receipt.checklist && receipt.checklist.length > 0)
      );
      if (!hasAction) {
        return { ok: false, error: "The receipt is empty: provide a conclusion or at least one action." };
      }
      try {
        const result = await ctx.submitKanbanReceipt({
          conclusion: receipt.conclusion?.trim() || undefined,
          ...(receipt.evidence?.length ? { evidence: receipt.evidence } : {}),
          ...(receipt.continueWork ? { continueWork: true } : {}),
          ...(receipt.handoffToAgentId?.trim() ? { handoffTo: { agentId: receipt.handoffToAgentId.trim(), brief: receipt.handoffBrief ?? "" } } : {}),
          ...(receipt.question?.trim() ? { question: { text: receipt.question.trim(), ...(receipt.questionOptions?.length ? { options: receipt.questionOptions } : {}) } } : {}),
          ...(receipt.verifyAt?.trim() ? { verifyAt: receipt.verifyAt.trim() } : {}),
          ...(receipt.requestCompletion ? { requestCompletion: true } : {}),
          ...(receipt.checklist?.length ? { checklist: receipt.checklist } : {})
        });
        if (!result.ok) return { ok: false, error: result.error };
        return {
          ok: true,
          content: [{
            type: "text",
            text: `Receipt recorded (${result.receiptId}). The runtime will settle this round from the receipt.`
          }],
          metadata: { receiptId: result.receiptId, recorded: result.recorded ?? true }
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
}
