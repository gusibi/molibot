import { decideDurableActivation } from "$lib/server/agent/decision/durableActivation.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
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
  settings?: RuntimeSettings;
  signal?: AbortSignal;
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
  return null;
}

export async function activateDurableExecution(
  request: DurableActivationRequest,
  coordinator = new DurableExecutionCoordinator(),
  decide = decideDurableActivation
): Promise<ActivatedDurableExecution | null> {
  if (request.mode === "suppress" || !request.message.trim()) return null;
  let decision = detectDurableActivation(request.message, request.mode ?? "auto");
  if (!decision) {
    const classified = await decide({ message: request.message, settings: request.settings, signal: request.signal });
    if (classified.mode !== "promote") return null;
    decision = { goal: request.message.trim(), activationPath: "lazy_promotion", reason: classified.reason };
  }
  request.signal?.throwIfAborted();

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
