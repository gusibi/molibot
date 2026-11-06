import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import type { PlanBinding } from "../durable/types.js";
import type { EffectiveExecutionPolicy } from "../permissions/resolvePermissionMode.js";

/** Approval belongs to this plan; it must not change a receiving Session's other work. */
export function planExecutionPolicy(settings: RuntimeSettings, binding: PlanBinding): EffectiveExecutionPolicy {
  const agent = settings.agents.find(agent => agent.id === binding.agentId && agent.enabled);
  if (!agent) throw new Error("The plan's Agent is unavailable. Enable it before continuing.");
  const mode = agent.permissionMode === "plan" ? "plan" : agent.permissionMode === "manual" ? "manual" : binding.mode;
  return { mode, source: "session", executionTarget: mode === "plan" ? "none" : "sandbox", sandbox: mode === "plan" ? undefined : settings.toolSandbox };
}
