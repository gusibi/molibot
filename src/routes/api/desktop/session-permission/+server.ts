import { basename } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { resolveEffectivePermissionMode } from "$lib/server/agent/permissions/resolvePermissionMode";
import { PERMISSION_MODES } from "$lib/server/agent/permissions/decidePermission";
import { getRuntimeContextForConversation, resolveRunnerChatId } from "$lib/server/web/runtimeContext";
import { sanitizeWebProfileId, toWebExternalUserId } from "$lib/server/web/identity";
import { approveDesktopPlan } from "$lib/server/app/desktopPlans.js";
import { projectDurableConversationPlan } from "$lib/server/agent/durable/planProjection.js";
import { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import type { DesktopPlanDecisionRequest, DesktopSessionPermissionUpdateRequest } from "$lib/shared/desktop";

function context(profileId: string, conversationId: string) {
  const runtime = getRuntime();
  const normalizedProfile = sanitizeWebProfileId(profileId);
  const runtimeContext = getRuntimeContextForConversation(normalizedProfile, conversationId);
  const fallback = toWebExternalUserId("web-anonymous", normalizedProfile);
  const chatId = resolveRunnerChatId(conversationId, fallback);
  return { runtime, normalizedProfile, runtimeContext, chatId };
}

export const GET: RequestHandler = async ({ url }) => {
  const profileId = String(url.searchParams.get("profileId") ?? "default");
  const conversationId = String(url.searchParams.get("conversationId") ?? "").trim();
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  const { runtime, normalizedProfile, runtimeContext, chatId } = context(profileId, conversationId);
  const resolved = resolveEffectivePermissionMode({
    getSettings: runtime.getSettings,
    chatId,
    sessionId: conversationId,
    store: runtimeContext.store,
    channel: "web",
    botId: basename(runtimeContext.store.getWorkspaceDir()) || normalizedProfile
  });
  // The UI renders "overridden for this conversation" vs "inherited from …"
  // from this one result instead of re-deriving the precedence itself.
  return json({ ok: true, mode: resolved.mode, source: resolved.source }, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopSessionPermissionUpdateRequest | DesktopPlanDecisionRequest;
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const conversationId = String(body.conversationId ?? "").trim();
  const profileId = String(body.profileId ?? "default");
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  const { runtimeContext, chatId, runtime } = context(profileId, conversationId);

  if ("planId" in body) {
    const decision = body.decision;
    const linked = runtime.sessions.updateConversationPlan(conversationId, body.planId, plan => plan);
    if (linked?.durableExecutionId) {
      try {
        const plans = new PlanService();
        let detail = plans.read("owner", linked.durableExecutionId);
        if (body.expectedVersion !== detail.execution.version) throw new Error("The plan has changed. Open its current version before deciding.");
        if (decision === "accept" || decision === "modify") {
          if (body.title !== undefined || body.summary !== undefined || body.steps !== undefined) {
            detail = plans.edit({ ownerId: "owner", executionId: detail.execution.id, expectedVersion: detail.execution.version, author: "user", title: body.title ?? detail.meta.title, summary: body.summary ?? detail.meta.summary,
              tasks: [{ title: body.title ?? detail.meta.title, steps: (body.steps ?? linked.steps.map(step => step.text)).map((title, index) => ({ id: detail.tasks.flatMap(task => task.steps)[index]?.id, title })) }],
              acceptanceCriteria: detail.acceptanceCriteria.filter(criterion => criterion.planVersion === detail.execution.currentPlanVersion) });
          }
          if (decision === "accept") detail = approveDesktopPlan(plans, runtime.sessions, runtime.getSettings(), { planId: detail.execution.id, expectedVersion: detail.execution.version, sessionId: conversationId, mode: body.mode === "manual" ? "manual" : "accept_edits" });
        } else if (decision === "reject") {
          detail = plans.cancel({ ownerId: "owner", planId: detail.execution.id, expectedVersion: detail.execution.version, actionId: crypto.randomUUID() });
        } else if (decision === "complete") {
          const request = detail.decisions.find(item => item.status === "open" && item.options.includes("confirm_completion"));
          if (!request) throw new Error("The plan is not awaiting owner acceptance.");
          new DurableExecutionCoordinator().answerDecision({ ownerId: "owner", executionId: detail.execution.id, expectedVersion: detail.execution.version, actionId: crypto.randomUUID(), decisionId: request.id, answer: "confirm_completion" });
          detail = plans.read("owner", detail.execution.id);
        } else throw new Error("Invalid plan decision.");
        const plan = { ...projectDurableConversationPlan(linked, detail), title: detail.meta.title, summary: detail.meta.summary };
        runtime.sessions.updateConversationPlan(conversationId, linked.id, () => plan);
        return json({ ok: true, plan, mode: detail.binding?.mode ?? "plan" });
      } catch (cause) { return json({ ok: false, error: String(cause instanceof Error ? cause.message : cause) }, { status: 409 }); }
    }

    if (decision === "complete") {
      const current = runtime.sessions.updateConversationPlan(conversationId, body.planId, (plan) => plan);
      if (!current || !["waiting_review", "completed"].includes(current.status)) return json({ ok: false, error: "Plan is not awaiting review." }, { status: 409 });
      const plan = runtime.sessions.updateConversationPlan(conversationId, body.planId, (value) => ({ ...value, status: "completed", progressSummary: undefined, updatedAt: new Date().toISOString() }));
      return json({ ok: true, plan }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!["accept", "reject", "modify"].includes(decision)) return json({ ok: false, error: "Invalid plan decision" }, { status: 400 });
    const existing = runtime.sessions.updateConversationPlan(conversationId, body.planId, (plan) => plan);
    if (!existing) return json({ ok: false, error: "Plan not found" }, { status: 404 });
    if (existing.status !== "proposed" && !(decision === "accept" && existing.status === "accepted")) {
      return json({ ok: false, error: "This plan has already been resolved. Continue in the current conversation." }, { status: 409 });
    }
    const plan = runtime.sessions.updateConversationPlan(conversationId, body.planId, (current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      title: String(body.title ?? current.title).trim() || current.title,
      summary: String(body.summary ?? current.summary).trim() || current.summary,
      steps: Array.isArray(body.steps) && body.steps.length
        ? body.steps.map((text, index) => ({
            id: current.steps[index]?.id ?? `${current.id}-${index + 1}`,
            text: String(text).trim(),
            status: current.steps[index]?.status ?? "pending"
          }))
        : current.steps,
      status: decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "proposed"
    }));
    if (!plan) return json({ ok: false, error: "Plan not found" }, { status: 404 });
    if (decision === "accept") {
      const mode = body.mode === "manual" ? "manual" : "accept_edits";
      runtimeContext.store.setSessionPermissionModeOverride(chatId, conversationId, mode);
      return json({ ok: true, plan, mode }, { headers: { "Cache-Control": "no-store" } });
    }
    if (decision === "modify") return json({ ok: true, plan, mode: "plan" }, { headers: { "Cache-Control": "no-store" } });
    return json({ ok: true, plan, mode: "plan" }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!PERMISSION_MODES.includes(body.mode)) return json({ ok: false, error: "Invalid permission mode" }, { status: 400 });
  runtimeContext.store.setSessionPermissionModeOverride(chatId, conversationId, body.mode);
  return json({ ok: true, mode: body.mode }, { headers: { "Cache-Control": "no-store" } });
};
