import type { PlanService } from "$lib/server/agent/plans/service.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { toWebExternalUserId } from "$lib/server/web/identity.js";
import { projectDurableConversationPlan } from "$lib/server/agent/durable/planProjection.js";
import { planExecutionPolicy } from "$lib/server/agent/plans/sessionDelivery.js";

export function approveDesktopPlan(plans: PlanService, sessions: SessionStore, settings: RuntimeSettings, input: {
  planId: string; expectedVersion: number; sessionId?: string; mode: "manual" | "accept_edits";
}) {
  const detail = plans.read("owner", input.planId);
  if (detail.execution.version !== input.expectedVersion) throw new Error("Plan version conflict. Reload and review the current version.");
  const sourceId = detail.execution.sourceUiSessionId;
  const sourceOwner = sourceId ? sessions.getWebConversationOwner(sourceId) : null;
  const source = sourceId ? detail.execution.sourceProjectId ? sessions.getProjectConversation(detail.execution.sourceProjectId, sourceId) : sourceOwner ? sessions.getConversationById(sourceId, "web", sourceOwner) : null : null;
  const agentId = detail.agentId ?? detail.binding?.agentId ?? source?.agentId;
  if (!agentId) throw new Error("The plan's original Agent is unavailable. Restore its source Session before continuing.");
  planExecutionPolicy(settings, { agentId, sessionId: "", mode: input.mode, approvedVersion: detail.execution.currentPlanVersion });
  let targetId = input.sessionId;
  if (targetId) {
    const projectId = sessions.getConversationProjectId(targetId) ?? undefined;
    if (projectId !== detail.execution.sourceProjectId) throw new Error("Choose a Session in the plan's original Project, or create a new receiving Session.");
    const owner = sessions.getWebConversationOwner(targetId);
    const target = projectId ? sessions.getProjectConversation(projectId, targetId) : owner ? sessions.getConversationById(targetId, "web", owner) : null;
    if (!target || (!projectId && target.agentId !== agentId)) throw new Error("Choose a Session owned by the plan's original Agent.");
  } else {
    const owner = sourceOwner ?? toWebExternalUserId("web-anonymous", `agent-${agentId}`);
    targetId = detail.execution.sourceProjectId
      ? sessions.createProjectConversation(detail.execution.sourceProjectId, owner).id
      : sessions.createWebConversation(owner, undefined, agentId).id;
  }
  const approved = plans.approve({ ownerId: "owner", planId: input.planId, expectedVersion: input.expectedVersion, sessionId: targetId, agentId, mode: input.mode });
  if (!sessions.listMessageMetadata(targetId).some(message => message.plan?.id === input.planId)) {
    const plan = projectDurableConversationPlan({ id: input.planId, durableExecutionId: input.planId, title: approved.meta.title, summary: approved.meta.summary, steps: [], status: "queued", recommendedMode: input.mode, artifactPath: "" }, approved);
    sessions.appendMessage(targetId, "assistant", approved.meta.title, { plan, contextBacked: false });
  }
  return approved;
}
