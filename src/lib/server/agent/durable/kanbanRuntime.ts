import type {
  KanbanReceipt,
  KanbanTaskConfig
} from "./types.js";
import type { AcceptanceCriterion, KanbanChecklistItem, KanbanUserInput } from "./types.js";

/**
 * Pure kanban round logic: attempt briefing composition and the receipt-driven
 * settlement decision. The durable runtime owns persistence and dispatch; this
 * module stays side-effect free so the decision rules are directly testable.
 */

export interface KanbanBriefingInput {
  task: KanbanTaskConfig;
  round: number;
  criteria: AcceptanceCriterion[];
  checklist: KanbanChecklistItem[];
  lastReceipt: KanbanReceipt | null;
  pendingInputs: KanbanUserInput[];
  handoffBrief?: string;
  scheduledReview?: boolean;
}

/** The per-round input. Dynamic per-round content must stay out of cache-stable prompt prefixes. */
export function buildKanbanBriefing(input: KanbanBriefingInput): string {
  const { task, round } = input;
  const lines: string[] = [];
  lines.push(`[看板任务 ${task.title}] 第 ${round} 轮`);
  if (task.form === "team") {
    const current = task.members.find(member => member.agentId === task.currentAgentId);
    lines.push(`本轮执行成员：${current ? `${current.name}（${current.agentId}）` : task.currentAgentId ?? "负责人"}`);
  }
  if (task.workDir) {
    lines.push(`工作目录：${task.workDir}`);
  }
  lines.push("");
  lines.push("## 目标");
  lines.push(task.goal);
  lines.push("");
  lines.push("## 完成条件（全部满足并附证据后才可申请完成）");
  if (input.criteria.length === 0) {
    lines.push("尚未确定完成条件：本轮先通过 kanban_receipt 的 proposeConditions 提出明确的、可见的完成条件（不要缩小目标），然后停下等用户确认或修订；确认前不要开展实质性工作。");
  } else {
    for (const criterion of input.criteria) {
      const mark = criterion.result === "passed" ? "[已通过]" : criterion.result === "failed" ? "[未通过]" : "[未判定]";
      lines.push(`- ${mark} ${criterion.description}`);
    }
  }
  if (input.checklist.length > 0) {
    lines.push("");
    lines.push("## 进度清单");
    for (const item of input.checklist) {
      lines.push(`- [${item.done ? "x" : " "}] ${item.text}`);
    }
  } else if (round === 1) {
    lines.push("");
    lines.push("## 进度清单");
    lines.push("如果这项工作有多个步骤，用回执工具维护一份勾选清单（做完一项勾一项）；简单的单一工作可以不建清单。");
  }
  if (input.lastReceipt) {
    lines.push("");
    lines.push(`## 上一轮回执摘要（第 ${input.lastReceipt.round} 轮）`);
    if (input.lastReceipt.actions.conclusion) lines.push(input.lastReceipt.actions.conclusion);
    if (input.handoffBrief) {
      lines.push("");
      lines.push("## 本次派发简报");
      lines.push(input.handoffBrief);
    }
  }
  if (input.pendingInputs.length > 0) {
    lines.push("");
    lines.push("## 用户补充（本轮消费，消费后不再重复出现）");
    for (const item of input.pendingInputs) {
      lines.push(`- ${item.text}`);
    }
  }
  if (input.scheduledReview) {
    lines.push("");
    lines.push("这是一次预约复查：核对外部状态与完成条件是否满足，再提交回执。");
  }
  lines.push("");
  lines.push("## 本轮回执要求");
  lines.push("结束本轮工作时，用 kanban_receipt 工具提交结构化回执：结论、证据；并明确下一步——继续工作（continue）、交接（团队任务）、提问、预约复查或申请完成。没有明确后续意图的本轮会停在等待用户确认。");
  return lines.join("\n");
}

/**
 * The initial prompt seeded into the visible task conversation (spec
 * 执行形态修订: 任务内容作为一份详细的初始提示词驱动执行). Human-facing record
 * of the request; the per-round model briefing stays in buildKanbanBriefing.
 */
export function buildKanbanTaskBrief(input: { title: string; goal: string; workDir?: string; conditions: string[] }): string {
  const lines: string[] = [];
  lines.push(`[看板任务] ${input.title}`);
  lines.push("");
  lines.push("## 目标");
  lines.push(input.goal);
  if (input.workDir) {
    lines.push("");
    lines.push(`工作目录：${input.workDir}`);
  }
  lines.push("");
  lines.push("## 完成条件");
  if (input.conditions.length === 0) {
    lines.push("待定：第一轮会先提出明确的完成条件，确认后再开展实质性工作。");
  } else {
    for (const condition of input.conditions) lines.push(`- ${condition}`);
  }
  return lines.join("\n");
}

export type KanbanRoundNext =
  | { kind: "continue" }
  | { kind: "verify" }
  | { kind: "question"; question: { text: string; options?: string[] } }
  | { kind: "schedule_review"; runAt: Date }
  | { kind: "handoff"; agentId: string; brief: string }
  | { kind: "wait_user"; reason: string };

/**
 * Receipt-driven settlement decision (spec: 回执决定续轮、交接、等待、复查或结案;
 * 缺少明确后续意图或完成证据时等待用户, 不隐式续跑).
 */
export function decideKanbanRoundOutcome(input: {
  receipt: KanbanReceipt | null;
  task: KanbanTaskConfig;
}): KanbanRoundNext {
  const { receipt, task } = input;
  if (!receipt || Object.keys(receipt.actions).length === 0) {
    return { kind: "wait_user", reason: "协议异常：本轮没有提交有效回执。已保留本轮产物；修正后由执行者继续或由你处理。" };
  }
  const actions = receipt.actions;
  if (actions.question?.text?.trim()) {
    return { kind: "question", question: { text: actions.question.text.trim(), ...(actions.question.options ? { options: actions.question.options } : {}) } };
  }
  if (actions.requestCompletion) return { kind: "verify" };
  if (actions.verifyAt) {
    const at = Date.parse(actions.verifyAt);
    if (Number.isFinite(at)) return { kind: "schedule_review", runAt: new Date(at) };
  }
  if (actions.handoffTo?.agentId?.trim()) {
    if (task.form !== "team") {
      return { kind: "wait_user", reason: "协议异常：单 Agent 任务提交了成员交接回执。已保留本轮产物。" };
    }
    return { kind: "handoff", agentId: actions.handoffTo.agentId.trim(), brief: actions.handoffTo.brief ?? "" };
  }
  if (actions.continueWork) return { kind: "continue" };
  return { kind: "wait_user", reason: "本轮已结束：执行者提交了回执但没有给出明确的继续意图或完成申请，等待你确认下一步。" };
}

export const KANBAN_USAGE_GAP_REASON = "用量统计缺口：上一轮模型用量缺失，已停止自动推进以避免预算失控。补充或确认后可继续。";

/** Safe-retry guard: 60s initial backoff, ×4 per attempt, at most 3 retries; persisted, survives restart. */
export const KANBAN_MAX_AUTO_RETRIES = 3;
export function kanbanRetryDelayMs(retryCount: number): number {
  return 60_000 * Math.pow(4, Math.max(0, retryCount));
}
export const KANBAN_RETRY_EXHAUSTED_SUFFIX = "\n\n自动重试已达上限（3 次）。请检查任务配置或运行环境后，确认是否继续重试或调整任务。";
