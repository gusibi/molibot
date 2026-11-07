import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { parsePlanRevision, proposePlanRevision } from "$lib/server/agent/plans/revision.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { resolveDurableToolApproval } from "$lib/server/agent/durable/approvalResolution.js";
import { approveDesktopPlan } from "$lib/server/app/desktopPlans.js";
import { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import { buildKanbanTaskBrief } from "$lib/server/agent/durable/kanbanRuntime.js";
import { steerKanbanRound } from "$lib/server/agent/durable/kanbanSteer.js";
import { persistDurableConversationInput } from "$lib/server/agent/durable/conversation.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { agentWorkspaceDir } from "$lib/server/sessions/agentStorage.js";
import { projectRuntimeWorkspaceDir } from "$lib/server/projects/runtimeCache.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { toWebExternalUserId } from "$lib/server/web/identity.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
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

/**
 * Appends a user message to the task's visible conversation and context-backs
 * it, so the session reads as one continuous dialogue when opened directly.
 */
function appendTaskConversationMessage(
  runtime: ReturnType<typeof getRuntime>,
  conversation: { id: string; externalUserId: string; agentId?: string },
  projectId: string,
  text: string
): void {
  const message = runtime.sessions.appendMessage(conversation.id, "user", text);
  try {
    persistDurableConversationInput(
      new MomRuntimeStore(projectId ? projectRuntimeWorkspaceDir(projectId) : agentWorkspaceDir(storagePaths.dataDir, conversation.agentId ?? "")),
      runtime.sessions,
      conversation.externalUserId,
      message
    );
  } catch { /* the visible message is already recorded; context backing is best-effort */ }
}

/** Best-effort removal of a task conversation whose task creation failed. */
function cleanupTaskConversation(
  runtime: ReturnType<typeof getRuntime>,
  conversation: { id: string },
  projectId: string,
  sessionOwner: string
): void {
  try {
    if (projectId) runtime.sessions.deleteProjectConversation(projectId, conversation.id);
    else runtime.sessions.deleteConversation(conversation.id, "web", sessionOwner);
  } catch { /* the task error is the one worth reporting */ }
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
      if (url.searchParams.get("kanban") === "true") {
        return json({ ok: true, ...plans.getKanbanBundle(owner, planId) }, { headers: { "Cache-Control": "no-store" } });
      }
      if (url.searchParams.get("diagnostics") === "true") {
        return json({ ok: true, diagnostics: plans.diagnostics(owner, planId) }, { headers: { "Cache-Control": "no-store" } });
      }
      const planVersion = Number(url.searchParams.get("planVersion") ?? "");
      const item = plans.read(owner, planId, Number.isFinite(planVersion) && planVersion > 0 ? planVersion : undefined);
      return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.searchParams.get("view") === "board") {
      const page = plans.boardPage({
        ownerId: owner,
        search: String(url.searchParams.get("search") ?? "").trim() || undefined,
        projectId: String(url.searchParams.get("projectId") ?? "").trim() || undefined,
        stage: (["todo", "doing", "done", "cancelled"] as const).find(stage => stage === url.searchParams.get("stage")),
        executorAgentId: String(url.searchParams.get("executorAgentId") ?? "").trim() || undefined,
        offset: Number(url.searchParams.get("offset") ?? 0),
        limit: Number(url.searchParams.get("limit") ?? 50)
      });
      return json({ ok: true, ...page }, { headers: { "Cache-Control": "no-store" } });
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
      case "kanban_create": {
        // Field allowlist: identity/source fields (kanbanTaskId, sourceType,
        // externalId, sourceUrl) come from internal callers only.
        const raw = body as unknown as Record<string, unknown>;
        const form = raw.form === "team" ? "team" as const : "single" as const;
        const projectId = raw.projectId ? String(raw.projectId).trim() : "";
        const executorAgentId = String((form === "single" ? raw.agentId : raw.coordinatorAgentId) ?? "").trim();
        const title = String(raw.title ?? "").trim();
        // Visible task conversation (spec 执行形态修订): with a Project it lives
        // in the Project's session list, otherwise under the executor Agent.
        const sessionOwner = toWebExternalUserId("kanban", "desktop");
        let conversation: { id: string; externalUserId: string } | null = null;
        // Team tasks give each member a visible read-only child session nested
        // under the main conversation (spec 执行形态修订 切片③).
        const memberSessions: Array<{ agentId: string; sessionId: string }> = [];
        if (projectId || executorAgentId) {
          const runtime = getRuntime();
          if (projectId && !getProjectStore().get(projectId)) throw new Error("Unknown project.");
          // origin "kanban" marks the session as task-triggered (list tag).
          conversation = projectId
            ? runtime.sessions.createProjectConversation(projectId, sessionOwner, "web", "kanban")
            : runtime.sessions.createWebConversation(sessionOwner, "kanban", executorAgentId || undefined);
          try {
            if (projectId) runtime.sessions.renameProjectConversation(projectId, conversation.id, title);
            else runtime.sessions.renameConversation(conversation.id, "web", sessionOwner, title);
            if (form === "team") {
              const coordinatorAgentId = String(raw.coordinatorAgentId ?? "").trim();
              for (const member of Array.isArray(raw.members) ? raw.members : []) {
                const memberAgentId = String((member as { agentId?: unknown })?.agentId ?? "").trim();
                // The coordinator works in the main conversation; only other members get child sessions.
                if (!memberAgentId || memberAgentId === coordinatorAgentId) continue;
                const memberName = String((member as { name?: unknown })?.name ?? "").trim() || memberAgentId;
                const child = runtime.sessions.createWebConversation(sessionOwner, "kanban", memberAgentId, conversation.id);
                runtime.sessions.renameConversation(child.id, "web", sessionOwner, `${title} · ${memberName}`);
                memberSessions.push({ agentId: memberAgentId, sessionId: child.id });
              }
            }
            appendTaskConversationMessage(
              runtime,
              { ...conversation, ...(projectId ? {} : { agentId: executorAgentId }) },
              projectId,
              buildKanbanTaskBrief({
                title,
                goal: String(raw.goal ?? "").trim() || title,
                ...(raw.workDir ? { workDir: String(raw.workDir).trim() } : {}),
                conditions: Array.isArray(raw.completionConditions)
                  ? raw.completionConditions.map(item => String((item as { description?: unknown })?.description ?? "").trim()).filter(Boolean)
                  : []
              })
            );
          } catch (cause) {
            for (const memberSession of memberSessions) {
              try { runtime.sessions.deleteConversation(memberSession.sessionId, "web", sessionOwner); } catch { /* best-effort cleanup */ }
            }
            cleanupTaskConversation(runtime, conversation, projectId, sessionOwner);
            throw cause;
          }
        }
        try {
          const item = plans.createKanbanTask({
            ownerId: owner,
            botId: String(raw.botId ?? "default").trim() || "default",
            form,
            title,
            goal: String(raw.goal ?? "").trim(),
            ...(raw.agentId ? { agentId: String(raw.agentId).trim() } : {}),
            ...(raw.coordinatorAgentId ? { coordinatorAgentId: String(raw.coordinatorAgentId).trim() } : {}),
            ...(Array.isArray(raw.members) ? { members: raw.members } : {}),
            ...(form === "team" && memberSessions.length > 0 ? { memberSessions } : {}),
            ...(projectId ? { projectId } : {}),
            ...(raw.workDir ? { workDir: String(raw.workDir).trim() } : {}),
            ...(Array.isArray(raw.completionConditions) ? { completionConditions: raw.completionConditions } : {}),
            ...(raw.completionSource === "user" ? { completionSource: "user" as const } : {}),
            ...(Number.isFinite(Number(raw.budgetTokenLimit)) ? { budgetTokenLimit: Number(raw.budgetTokenLimit) } : {}),
            ...(Number.isFinite(Number(raw.handoffLimit)) && Number(raw.handoffLimit) > 0 ? { handoffLimit: Number(raw.handoffLimit) } : {}),
            ...(raw.approvalPolicy === "deny" || raw.approvalPolicy === "suspend" ? { approvalPolicy: raw.approvalPolicy } : {}),
            ...(raw.humanAcceptance === true ? { humanAcceptance: true } : {}),
            ...(conversation ? { sourceUiSessionId: conversation.id } : {}),
            autoStart: raw.autoStart !== false
          });
          return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
        } catch (cause) {
          if (conversation) {
            const runtime = getRuntime();
            for (const memberSession of memberSessions) {
              try { runtime.sessions.deleteConversation(memberSession.sessionId, "web", sessionOwner); } catch { /* best-effort cleanup */ }
            }
            cleanupTaskConversation(runtime, conversation, projectId, sessionOwner);
          }
          throw cause;
        }
      }
      case "kanban_start":
        return json({ ok: true, item: plans.startKanbanTask({ ownerId: owner, executionId: String(body.planId), expectedVersion: Number(body.expectedVersion), actionId: String(body.actionId) }) }, { headers: { "Cache-Control": "no-store" } });
      case "kanban_answer": {
        const item = plans.answerKanbanTask({ ownerId: owner, executionId: String(body.planId), text: String(body.text ?? "").trim() });
        return json({ ok: true, item }, { headers: { "Cache-Control": "no-store" } });
      }
      case "kanban_steer": {
        const executionId = String(body.planId ?? "").trim();
        const text = String(body.text ?? "").trim();
        if (!text) throw new Error("Empty message.");
        const { task, detail } = plans.getKanbanTask(owner, executionId);
        const runtime = getRuntime();
        // Live injection first (spec 执行形态修订 切片②); when no round is
        // running the message falls back to the pending-input channel.
        const delivered = steerKanbanRound(executionId, text);
        if (!delivered) plans.answerKanbanTask({ ownerId: owner, executionId, text });
        const sessionId = detail.execution.sourceUiSessionId?.trim();
        if (sessionId) {
          const projectIdOfSession = runtime.sessions.getConversationProjectId(sessionId) ?? "";
          const ownerOfSession = projectIdOfSession ? "" : runtime.sessions.getWebConversationOwner(sessionId) ?? "";
          const conversation = projectIdOfSession
            ? runtime.sessions.getProjectConversation(projectIdOfSession, sessionId)
            : ownerOfSession
              ? runtime.sessions.getConversationById(sessionId, "web", ownerOfSession)
              : null;
          if (conversation) {
            appendTaskConversationMessage(runtime, conversation, projectIdOfSession, text);
          }
        }
        return json({ ok: true, delivered }, { headers: { "Cache-Control": "no-store" } });
      }
      case "kanban_budget":
        return json({ ok: true, item: plans.addKanbanBudget({ ownerId: owner, executionId: String(body.planId), expectedVersion: Number(body.expectedVersion), addTokens: Number(body.addTokens) }) }, { headers: { "Cache-Control": "no-store" } });
      case "kanban_conditions": {
        const descriptions = Array.isArray(body.conditions) ? body.conditions.map(item => String(item ?? "").trim()).filter(Boolean) : [];
        if (descriptions.length === 0) throw new Error("At least one completion condition is required.");
        return json({ ok: true, item: plans.setKanbanCompletionConditions({ ownerId: owner, executionId: String(body.planId), expectedVersion: Number(body.expectedVersion), descriptions }) }, { headers: { "Cache-Control": "no-store" } });
      }
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
