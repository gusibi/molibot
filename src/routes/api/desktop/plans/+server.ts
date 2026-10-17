import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { parsePlanRevision, proposePlanRevision } from "$lib/server/agent/plans/revision.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { resolveDurableToolApproval } from "$lib/server/agent/durable/approvalResolution.js";
import { approveDesktopPlan } from "$lib/server/app/desktopPlans.js";
import { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import {
  DURABLE_EXECUTION_STATUSES,
  PlanDeletedError,
  type CreatePlanInput,
  type DurableExecutionStatus,
  type PlanListFilter,
  type ReplacePlanContentInput,
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

export const GET: RequestHandler = async ({ url, request }) => {
  if (url.searchParams.get("stream") === "true") {
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { unsubscribe(); if (timer) clearInterval(timer); };
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (type: string) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type })}\n\n`)); } catch { stop(); } };
        unsubscribe = plans.subscribe(() => send("changed"));
        send("snapshot");
        timer = setInterval(() => send("heartbeat"), 1000);
        request.signal.addEventListener("abort", () => { stop(); try { controller.close(); } catch {} }, { once: true });
      }, cancel: stop
    }), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }
  try {
    const owner = "owner";
    if (url.searchParams.has("ownerId") && url.searchParams.get("ownerId") !== owner) throw new Error("Unknown plan owner.");
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
      offset: Number(url.searchParams.get("offset") ?? 0),
      limit: Number(url.searchParams.get("limit") ?? 50)
    };
    return json({ ok: true, ...plans.listPage(filter) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return failure(cause);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as Record<string, unknown> & { action?: string; ownerId?: string; planId?: string };
    const owner = "owner";
    if (body.ownerId && body.ownerId !== owner) throw new Error("Unknown plan owner.");
    switch (body.action) {
      case "propose": {
        const detail = plans.read(owner, String(body.planId));
        if (detail.execution.version !== body.expectedVersion) throw new Error("Plan version conflict. Reload before generating a revision.");
        const runtime = getRuntime();
        const draft = await proposePlanRevision(detail, String(body.instruction ?? ""), runtime.getSettings(), runtime.usageTracker, request.signal);
        return json({ ok: true, draft, expectedVersion: detail.execution.version });
      }
      case "approve": {
        if (body.mode !== "manual" && body.mode !== "accept_edits") throw new Error("Choose Manual or Accept edits before approving.");
        const runtime = getRuntime();
        const item = approveDesktopPlan(plans, runtime.sessions, runtime.getSettings(), { planId: String(body.planId), expectedVersion: Number(body.expectedVersion), sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined, mode: body.mode });
        return json({ ok: true, item });
      }
      case "edit": {
        parsePlanRevision(body);
        return json({ ok: true, item: plans.edit({ ...(body as unknown as ReplacePlanContentInput), ownerId: owner, author: "user" }) });
      }
      case "answer": {
        new DurableExecutionCoordinator().answerDecision({ ownerId: owner, executionId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId), decisionId: String(body.decisionId), answer: String(body.answer) });
        return json({ ok: true, item: plans.read(owner, String(body.planId)) });
      }
      case "approval": {
        if (body.status !== "approved" && body.status !== "rejected") throw new Error("Invalid approval decision.");
        resolveDurableToolApproval({ coordinator: new DurableExecutionCoordinator(), broker: getApprovalBroker(), hostBashStore: getRuntime().hostBashStore }, { ownerId: owner, executionId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId), approvalId: String(body.approvalId), status: body.status, selectedScope: "once" });
        return json({ ok: true, item: plans.read(owner, String(body.planId)) });
      }
      case "create": {
        const item = plans.create({ ...(body as unknown as CreatePlanInput), ownerId: owner });
        return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
      }
      case "revise": {
        const item = plans.revise({ ...(body as unknown as RevisePlanInput), ownerId: owner, author: "user" });
        return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
      }
      case "pause":
        return json({ ok: true, item: plans.pause({ ownerId: owner, planId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId), reason: typeof body.reason === "string" ? body.reason : undefined }) }, { headers: { "Cache-Control": "no-store" } });
      case "resume":
        if (!plans.read(owner, String(body.planId)).binding) throw new Error("Approve this plan version before continuing.");
        return json({ ok: true, item: plans.resume({ ownerId: owner, planId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId) }) }, { headers: { "Cache-Control": "no-store" } });
      case "cancel":
        return json({ ok: true, item: plans.cancel({ ownerId: owner, planId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId), reason: typeof body.reason === "string" ? body.reason : undefined }) }, { headers: { "Cache-Control": "no-store" } });
      case "delete": {
        const result = plans.delete({ ownerId: owner, planId: String(body.planId), expectedVersion: body.expectedVersion === undefined ? undefined : Number(body.expectedVersion) });
        return json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
      }
      case "complete": {
        const detail = plans.read(owner, String(body.planId));
        if (body.expectedVersion !== detail.execution.version) throw new Error("Plan version conflict. Reload before confirming completion.");
        const decision = detail.decisions.find(decision => decision.status === "open" && decision.options.includes("confirm_completion"));
        if (!decision) throw new Error("The plan is not awaiting owner acceptance.");
        new DurableExecutionCoordinator().answerDecision({ ownerId: owner, executionId: detail.execution.id, expectedVersion: detail.execution.version, actionId: String(body.actionId), decisionId: decision.id, answer: "confirm_completion" });
        return json({ ok: true, item: plans.read(owner, detail.execution.id) });
      }
      default:
        return json({ ok: false, error: `Unknown plan action: ${String(body.action)}` }, { status: 400 });
    }
  } catch (cause) {
    return failure(cause);
  }
};
