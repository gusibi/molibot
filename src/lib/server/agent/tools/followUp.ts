import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PlanService } from "$lib/server/agent/plans/service.js";
import type { FollowUpSourceRef } from "$lib/server/agent/durable/types.js";

const sourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal("project_file"), relativePath: Type.String() }),
  Type.Object({ kind: Type.Literal("plan"), planId: Type.String() }),
  Type.Object({ kind: Type.Literal("execution"), executionId: Type.String() })
]);

const followUpToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("create"),
    title: Type.String({ description: "Short title for the delegated follow-up." }),
    goal: Type.String({ description: "Expected outcome and what to watch for." }),
    sources: Type.Array(sourceSchema, { minItems: 1, description: "Authorized read-only sources (project files, plan, or execution)." }),
    checkIntervalMinutes: Type.Number({ minimum: 1, description: "Check cadence in minutes." }),
    expiresAt: Type.String({ description: "ISO 8601 UTC/offset expiration time for this authorization." }),
    nextCheckAt: Type.Optional(Type.String({ description: "Optional ISO 8601 first check time; defaults to now + checkIntervalMinutes." })),
    fixedCheckins: Type.Optional(Type.Array(Type.String(), { description: "Optional ISO 8601 fixed check-in timestamps that always report to the user." })),
    missingEvidencePolicy: Type.Optional(Type.Union([
      Type.Literal("wait"),
      Type.Literal("ask_at_check"),
      Type.Literal("notify_unavailable")
    ])),
    completionConditions: Type.Optional(Type.Array(Type.String(), { description: "Optional explicit completion criteria." })),
    requestId: Type.Optional(Type.String({ description: "Idempotency key for safe retries." }))
  }),
  Type.Object({
    action: Type.Literal("get"),
    executionId: Type.String()
  }),
  Type.Object({
    action: Type.Literal("snooze"),
    executionId: Type.String(),
    expectedVersion: Type.Number(),
    until: Type.String({ description: "ISO 8601 future timestamp earlier than expiresAt." })
  }),
  Type.Object({
    action: Type.Literal("complete"),
    executionId: Type.String(),
    expectedVersion: Type.Number()
  })
]);

export function createFollowUpTool(options: {
  planService: PlanService;
  ownerId: string;
  botId: string;
  agentId: string;
  timezone: string;
  projectId?: string;
  workDir?: string;
  sourceUiSessionId?: string;
}): AgentTool<typeof followUpToolSchema> {
  return {
    name: "followUp",
    label: "followUp",
    description: [
      "Create, inspect, snooze, or complete an authorized follow-up task (Kanban Task in follow_up mode).",
      "Only call action=create when the user explicitly delegated a concrete follow-up with clear sources, check cadence, and expiration; never create follow-ups from casual wishes.",
      "Follow-ups are read-only checks over authorized project files, plans, or executions; write operations still require normal approval."
    ].join("\n"),
    parameters: followUpToolSchema,
    execute: async (_toolCallId, params) => {
      if (params.action === "get") {
        const bundle = options.planService.getKanbanBundle(options.ownerId, params.executionId);
        return jsonResult({
          executionId: bundle.task.executionId,
          title: bundle.task.title,
          mode: bundle.task.mode,
          version: bundle.detail.execution.version,
          followUp: bundle.followUp ?? null
        });
      }

      if (params.action === "snooze") {
        const until = new Date(params.until);
        if (!Number.isFinite(until.getTime())) throw new Error("until must be a valid ISO 8601 timestamp.");
        const bundle = options.planService.snoozeFollowUpTask({
          ownerId: options.ownerId,
          executionId: params.executionId,
          expectedVersion: params.expectedVersion,
          until
        });
        return jsonResult({
          snoozed: true,
          executionId: bundle.task.executionId,
          version: bundle.detail.execution.version,
          nextCheckAt: bundle.followUp?.config.nextCheckAt
        });
      }

      if (params.action === "complete") {
        const bundle = options.planService.completeFollowUpTask({
          ownerId: options.ownerId,
          executionId: params.executionId,
          expectedVersion: params.expectedVersion
        });
        return jsonResult({
          completed: true,
          executionId: bundle.task.executionId,
          version: bundle.detail.execution.version,
          lifecycle: bundle.followUp?.lifecycle
        });
      }

      const now = new Date();
      const expiresAt = new Date(params.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
        throw new Error("expiresAt must be a valid future ISO 8601 timestamp.");
      }
      const checkIntervalMs = Math.max(60_000, Math.round(params.checkIntervalMinutes * 60_000));
      const nextCheckAt = params.nextCheckAt ? new Date(params.nextCheckAt) : new Date(now.getTime() + checkIntervalMs);
      if (!Number.isFinite(nextCheckAt.getTime())) {
        throw new Error("nextCheckAt must be a valid ISO 8601 timestamp.");
      }

      const created = options.planService.createFollowUpTask({
        ownerId: options.ownerId,
        botId: options.botId,
        agentId: options.agentId,
        title: params.title,
        goal: params.goal,
        projectId: options.projectId,
        workDir: options.workDir,
        sources: params.sources as FollowUpSourceRef[],
        completionConditions: (params.completionConditions ?? []).map(description => ({ description })),
        missingEvidencePolicy: params.missingEvidencePolicy ?? "wait",
        timezone: options.timezone,
        checkIntervalMs,
        nextCheckAt,
        fixedCheckins: params.fixedCheckins ?? [],
        expiresAt,
        notifyTarget: { kind: "desktop" },
        requestId: params.requestId,
        sourceUiSessionId: options.sourceUiSessionId,
        now
      });

      return jsonResult({
        created: created.created,
        executionId: created.bundle.task.executionId,
        version: created.bundle.detail.execution.version,
        nextCheckAt: created.bundle.followUp?.config.nextCheckAt,
        expiresAt: created.bundle.followUp?.config.expiresAt,
        lifecycle: created.bundle.followUp?.lifecycle
      });
    }
  };
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: undefined
  };
}
