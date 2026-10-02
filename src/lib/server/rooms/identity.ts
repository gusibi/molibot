import type { RuntimeSettings, AgentSettings } from "$lib/server/settings/schema.js";
import type { AgentRoom, RoomExecution, RoomPermissionMode } from "$lib/shared/rooms.js";
import type { EffectiveExecutionPolicy } from "$lib/server/agent/permissions/resolvePermissionMode.js";
import type { ProjectRecord } from "$lib/server/projects/store.js";

const rank: Record<RoomPermissionMode, number> = { plan: 0, manual: 1, accept_edits: 2, auto: 3 };
export function roomPolicy(settings: RuntimeSettings, room: AgentRoom, agent: AgentSettings, mode: RoomExecution["mode"]): EffectiveExecutionPolicy {
  const limits = [settings.permissionMode, room.permissionMode, agent.permissionMode].filter((x): x is RoomPermissionMode => Boolean(x));
  const permission = mode === "plan" ? "plan" : limits.reduce((a, b) => rank[a] <= rank[b] ? a : b, "auto");
  return { mode: permission, source: "agent", executionTarget: permission === "plan" ? "none" : permission === "auto" ? "host" : "sandbox",
    sandbox: permission === "manual" || permission === "accept_edits" ? settings.toolSandbox : undefined };
}
export function roomSettings(settings: RuntimeSettings, agent: AgentSettings, project?: ProjectRecord): RuntimeSettings {
  return { ...settings, modelRouting: { ...settings.modelRouting, ...agent.modelRouting,
    textModelKey: agent.modelRouting?.textModelKey || project?.modelKey || settings.modelRouting.textModelKey,
    sttModelKey: agent.modelRouting?.sttModelKey || settings.modelRouting.sttModelKey } };
}
export function isStricter(current: EffectiveExecutionPolicy, starting: EffectiveExecutionPolicy) { return rank[current.mode] < rank[starting.mode]; }
