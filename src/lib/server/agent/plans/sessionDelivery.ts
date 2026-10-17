import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { DurableExecution, PlanBinding } from "../durable/types.js";
import type { EffectiveExecutionPolicy } from "../permissions/resolvePermissionMode.js";

/** Approval belongs to this plan; it must not change a receiving Session's other work. */
export function planExecutionPolicy(settings: RuntimeSettings, binding: PlanBinding): EffectiveExecutionPolicy {
  const agent = settings.agents.find(agent => agent.id === binding.agentId && agent.enabled);
  if (!agent) throw new Error("The plan's Agent is unavailable. Enable it before continuing.");
  const mode = agent.permissionMode === "plan" ? "plan" : agent.permissionMode === "manual" ? "manual" : binding.mode;
  return { mode, source: "session", executionTarget: mode === "plan" ? "none" : "sandbox", sandbox: mode === "plan" ? undefined : settings.toolSandbox };
}

export function deliverPlanAttempt(sessions: SessionStore, input: { execution: DurableExecution; binding: PlanBinding; runId: string; text: string }): void {
  const id = input.binding.sessionId;
  const project = sessions.getConversationProjectId(id);
  const owner = sessions.getWebConversationOwner(id);
  const target = project ? sessions.getProjectConversation(project, id) : owner ? sessions.getConversationById(id, "web", owner) : null;
  if (!target) return;
  if (sessions.listMessageMetadata(id).some(message => message.sourceEntryId === `durable-plan:${input.execution.id}:${input.runId}`)) return;
  sessions.appendMessage(id, "assistant", input.text, { sourceEntryId: `durable-plan:${input.execution.id}:${input.runId}`, contextBacked: false });
}
