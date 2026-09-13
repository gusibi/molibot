import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import {
  DURABLE_EXECUTION_STATUSES,
  PlanDeletedError,
  type CreatePlanInput,
  type DurableExecutionStatus,
  type PlanListFilter,
  type RevisePlanInput
} from "$lib/server/agent/durable/types.js";
import {
  DurableExecutionConflictError,
  DurableExecutionLeaseError,
  DurableExecutionNotFoundError,
  DurableExecutionTransitionError
} from "$lib/server/agent/durable/store.js";

const plans = new PlanService();

function ownerId(value: unknown): string {
  return String(value ?? "owner").trim() || "owner";
}

function failure(cause: unknown): Response {
  const status = cause instanceof DurableExecutionNotFoundError
    ? 404
    : cause instanceof PlanDeletedError
      ? 410
      : cause instanceof DurableExecutionConflictError || cause instanceof DurableExecutionTransitionError || cause instanceof DurableExecutionLeaseError
        ? 409
        : 400;
  return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status });
}

function statusFilter(value: string | null): DurableExecutionStatus[] | undefined {
  if (!value) return undefined;
  const parsed = value.split(",").map((item) => item.trim()).filter((item): item is DurableExecutionStatus => (DURABLE_EXECUTION_STATUSES as readonly string[]).includes(item));
  return parsed.length > 0 ? parsed : undefined;
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const owner = ownerId(url.searchParams.get("ownerId"));
    const planId = String(url.searchParams.get("id") ?? "").trim();
    if (planId) {
      const planVersion = Number(url.searchParams.get("planVersion") ?? "");
      const item = plans.read(owner, planId, Number.isFinite(planVersion) && planVersion > 0 ? planVersion : undefined);
      return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
    }
    const filter: PlanListFilter = {
      ownerId: owner,
      botId: String(url.searchParams.get("botId") ?? "").trim() || undefined,
      projectId: String(url.searchParams.get("projectId") ?? "").trim() || undefined,
      search: String(url.searchParams.get("search") ?? "").trim() || undefined,
      statuses: statusFilter(url.searchParams.get("statuses")),
      includeArchived: url.searchParams.get("includeArchived") === "true" || statusFilter(url.searchParams.get("statuses"))?.includes("completed"),
      limit: Number(url.searchParams.get("limit") ?? 50)
    };
    return json({ ok: true, items: plans.list(filter) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return failure(cause);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as Record<string, unknown> & { action?: string; ownerId?: string; planId?: string };
    const owner = ownerId(body.ownerId);
    switch (body.action) {
      case "create": {
        const item = plans.create({ ...(body as unknown as CreatePlanInput), ownerId: owner });
        return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
      }
      case "revise": {
        const item = plans.revise({ ...(body as unknown as RevisePlanInput), ownerId: owner });
        return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
      }
      case "start":
        return json({ ok: true, item: plans.start({ ownerId: owner, planId: String(body.planId), expectedVersion: Number(body.expectedVersion) }) }, { headers: { "Cache-Control": "no-store" } });
      case "pause":
        return json({ ok: true, item: plans.pause({ ownerId: owner, planId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId), reason: typeof body.reason === "string" ? body.reason : undefined }) }, { headers: { "Cache-Control": "no-store" } });
      case "resume":
        return json({ ok: true, item: plans.resume({ ownerId: owner, planId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId) }) }, { headers: { "Cache-Control": "no-store" } });
      case "cancel":
        return json({ ok: true, item: plans.cancel({ ownerId: owner, planId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId), reason: typeof body.reason === "string" ? body.reason : undefined }) }, { headers: { "Cache-Control": "no-store" } });
      case "delete": {
        const result = plans.delete({ ownerId: owner, planId: String(body.planId), expectedVersion: body.expectedVersion === undefined ? undefined : Number(body.expectedVersion) });
        return json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
      }
      case "complete": {
        // Owner confirmation for a plan whose turn already finished. Plans live
        // as Session turns, so completion is recorded on the source Session plan
        // and mirrored into the durable record the board reads.
        const planId = String(body.planId);
        const detail = plans.read(owner, planId);
        const sessionId = detail.execution.sourceUiSessionId;
        if (!sessionId) return json({ ok: false, error: "Plan has no source session." }, { status: 409 });
        const updated = getRuntime().sessions.updateConversationPlan(sessionId, planId, (plan) => ({
          ...plan,
          status: "completed",
          progressSummary: undefined,
          updatedAt: new Date().toISOString()
        }));
        if (!updated) return json({ ok: false, error: "Plan not found in its source session." }, { status: 404 });
        plans.mirrorFromConversationPlan(updated);
        return json({ ok: true, item: plans.read(owner, planId) }, { headers: { "Cache-Control": "no-store" } });
      }
      default:
        return json({ ok: false, error: `Unknown plan action: ${String(body.action)}` }, { status: 400 });
    }
  } catch (cause) {
    return failure(cause);
  }
};
