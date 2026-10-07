import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionQuotaError, type DurableExecutionListItem } from "./types.js";
import type { DurablePrefixEntry } from "./types.js";
import type { DurablePreflightDecision } from "./preflight.js";

export type DurableRequestMode = "auto" | "force" | "suppress";

export interface DurableActivationDecision {
  goal: string;
  activationPath: "deterministic" | "lazy_promotion" | "forced";
  reason: string;
}

export interface DurableActivationRequest {
  message: string;
  mode?: DurableRequestMode;
  ownerId: string;
  botId: string;
  sourceChannel: string;
  sourceChatId: string;
  sourceUiSessionId?: string;
  sourceProjectId?: string;
  maxUnfinishedExecutions?: number;
}

export interface ActivatedDurableExecution {
  decision: DurableActivationDecision;
  item: DurableExecutionListItem;
}

const EXPLICIT_COMMAND = /^\/(?:durable|long[-_]?task|long[-_]?execution)\b\s*/i;
export const DEFAULT_MAX_UNFINISHED_DURABLE_EXECUTIONS = 20;

// These are intentionally narrow product signals, not a natural-language
// classifier. A normal request stays on the fast path until lazy promotion is
// added at the first non-pure tool boundary.
const CROSS_SESSION_SIGNAL = /(?:多日|跨天|跨会话|几天后|未来几天|稍后继续|下次继续|明天继续|持续推进|定期(?:汇报|更新|执行)|每天(?:汇报|更新|执行)|每周(?:汇报|更新|执行)|分阶段(?:完成|推进|执行)|长期(?:推进|执行)|\b(?:multi[- ]day|across sessions?|continue later|resume later|keep working|daily updates?|weekly updates?|periodic(?:ally)? report|work over the next few days)\b)/iu;

// A one-shot request that clearly spans several work items still needs the
// persistent path even when the owner never says "multi-day". These are
// deterministic signals, so they do not depend on the preflight model and
// cannot silently degrade to an ordinary Run.
const URL_PATTERN = /https?:\/\/[^\s"'<>()\]]+/giu;
const BULK_CONTENT_SIGNAL = /(?:逐[个篇章节条项]|逐一|每[个篇章节条项]|批量|全部|所有|(?:这|那)(?:些|几)|(?:几|数)[个篇章节条项])/u;
const CONTENT_ACTION_SIGNAL = /(?:保存|收录|整理|翻译|改写|重写|生成|导出|发布|上线|校对|构建|同步|下载)/u;

function countUrls(message: string): number {
  return (message.match(URL_PATTERN) ?? []).length;
}

function cleanExplicitCommand(message: string): string {
  return message.replace(EXPLICIT_COMMAND, "").trim();
}

export function parseDurableRequestMode(value: unknown): DurableRequestMode | undefined {
  const mode = String(value ?? "").trim().toLowerCase();
  return mode === "auto" || mode === "force" || mode === "suppress" ? mode : undefined;
}

export function detectDurableActivation(message: string, mode: DurableRequestMode = "auto"): DurableActivationDecision | null {
  const raw = String(message ?? "").trim();
  if (!raw || mode === "suppress") return null;

  const explicit = EXPLICIT_COMMAND.test(raw);
  const goal = explicit ? cleanExplicitCommand(raw) : raw;
  if (mode === "force" || explicit) {
    return {
      goal: goal || raw,
      activationPath: "forced",
      reason: mode === "force" ? "per_request_override" : "explicit_long_task_command"
    };
  }
  if (CROSS_SESSION_SIGNAL.test(raw)) {
    return {
      goal: raw,
      activationPath: "deterministic",
      reason: "cross_session_execution_intent"
    };
  }
  if (countUrls(raw) >= 2 && CONTENT_ACTION_SIGNAL.test(raw)) {
    return {
      goal: raw,
      activationPath: "deterministic",
      reason: "multi_item_request"
    };
  }
  if (BULK_CONTENT_SIGNAL.test(raw) && CONTENT_ACTION_SIGNAL.test(raw)) {
    return {
      goal: raw,
      activationPath: "deterministic",
      reason: "bulk_content_request"
    };
  }
  return null;
}

/**
 * When the model preflight degrades (unavailable, error, or invalid output) it
 * must not silently return to the ordinary Run for a request that already
 * carries a deterministic long-task signal. This turns that degradation into a
 * promotion decision so the request stays tracked instead of losing its goal.
 */
export function deterministicPromotionFallback(message: string, degraded: boolean): DurablePreflightDecision | null {
  if (!degraded) return null;
  const decision = detectDurableActivation(message);
  if (!decision || decision.activationPath === "forced") return null;
  return {
    mode: "promote",
    reason: `deterministic_fallback:${decision.reason}`,
    goal: decision.goal,
    acceptanceCriteria: [{
      description: "The requested goal is satisfied and can be confirmed by the owner.",
      checkerType: "subjective",
      author: "model"
    }],
    expectedWait: "unknown"
  };
}

export function activateDurableExecution(
  request: DurableActivationRequest,
  coordinator = new DurableExecutionCoordinator()
): ActivatedDurableExecution | null {
  const decision = detectDurableActivation(request.message, request.mode ?? "auto");
  if (!decision) return null;

  const maxUnfinished = Number.isFinite(request.maxUnfinishedExecutions)
    ? Math.max(1, Math.floor(request.maxUnfinishedExecutions!))
    : DEFAULT_MAX_UNFINISHED_DURABLE_EXECUTIONS;
  if (decision.activationPath !== "forced" && coordinator.countUnfinished(request.ownerId) >= maxUnfinished) {
    throw new DurableExecutionQuotaError(request.ownerId, maxUnfinished);
  }

  const created = coordinator.create({
    ownerId: request.ownerId,
    botId: request.botId,
    sourceChannel: request.sourceChannel,
    sourceChatId: request.sourceChatId,
    sourceUiSessionId: request.sourceUiSessionId,
    sourceProjectId: request.sourceProjectId,
    goal: decision.goal,
    steps: [{
      title: "Work through the requested goal",
      description: "Execute the next safe portion of the request and leave evidence for verification.",
      sideEffectClass: "non_idempotent"
    }],
    acceptanceCriteria: [{
      description: "The requested goal is satisfied and can be confirmed by the owner.",
      checkerType: "subjective",
      author: "model"
    }],
    activationPath: decision.activationPath,
    activationReason: decision.reason
  });
  const item = coordinator.activate({
    ownerId: request.ownerId,
    executionId: created.execution.id,
    expectedVersion: created.execution.version
  });
  return { decision, item };
}

export function promoteDurableExecution(
  request: {
    message: string;
    ownerId: string;
    botId: string;
    sourceChannel: string;
    sourceChatId: string;
    sourceUiSessionId?: string;
    sourceProjectId?: string;
    decision: DurablePreflightDecision;
    prefix: DurablePrefixEntry[];
    currentEffect: DurablePrefixEntry["effect"];
    maxUnfinishedExecutions?: number;
  },
  coordinator = new DurableExecutionCoordinator()
): ActivatedDurableExecution {
  const maxUnfinished = Number.isFinite(request.maxUnfinishedExecutions)
    ? Math.max(1, Math.floor(request.maxUnfinishedExecutions!))
    : DEFAULT_MAX_UNFINISHED_DURABLE_EXECUTIONS;
  if (coordinator.countUnfinished(request.ownerId) >= maxUnfinished) {
    throw new DurableExecutionQuotaError(request.ownerId, maxUnfinished);
  }
  const goal = request.decision.goal?.trim() || request.message.trim();
  const acceptanceCriteria = request.decision.acceptanceCriteria?.length
    ? request.decision.acceptanceCriteria
    : [{
        description: "The requested goal is satisfied and can be confirmed by the owner.",
        checkerType: "subjective" as const,
        author: "model" as const
      }];
  const item = coordinator.promote({
    ownerId: request.ownerId,
    botId: request.botId,
    sourceChannel: request.sourceChannel,
    sourceChatId: request.sourceChatId,
    sourceUiSessionId: request.sourceUiSessionId,
    sourceProjectId: request.sourceProjectId,
    goal,
    acceptanceCriteria,
    prefix: request.prefix,
    currentEffect: request.currentEffect,
    reason: `lazy_preflight:${request.decision.reason}`
  });
  return {
    decision: {
      goal,
      activationPath: "lazy_promotion",
      reason: request.decision.reason
    },
    item
  };
}

export function formatDurableActivationAcknowledgement(
  item: DurableExecutionListItem,
  chinese: boolean
): string {
  return chinese
    ? `已创建长任务 ${item.execution.shortHandle}，正在排队执行。任务状态和进度会在当前会话卡片中持续更新。`
    : `Created durable execution ${item.execution.shortHandle}. It is queued now, and its status and progress will update in this conversation card.`;
}
