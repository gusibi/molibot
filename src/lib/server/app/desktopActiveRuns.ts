import type { TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { DesktopActiveRunItem } from "$lib/shared/desktop";

const STUCK_AFTER_MS = 10 * 60_000;

export interface ActiveRunnerSnapshot {
  channel: string;
  botId: string;
  chatId: string;
  sessionId: string;
}

export function buildDesktopActiveRuns(
  settings: RuntimeSettings,
  facts: TraceFactRecord[],
  snapshots: ActiveRunnerSnapshot[],
  nowMs = Date.now()
): DesktopActiveRunItem[] {
  const live = new Set(snapshots.map((item) => `${item.channel}\0${item.botId}\0${item.chatId}\0${item.sessionId}`));
  const botDetails = new Map<string, { name: string; agentId: string }>();
  for (const [channel, group] of Object.entries(settings.channels ?? {})) {
    for (const instance of group.instances ?? []) {
      botDetails.set(`${channel}\0${instance.id}`, {
        name: instance.name || instance.id,
        agentId: String(instance.agentId ?? "").trim() || "default"
      });
    }
  }
  const agentNames = new Map((settings.agents ?? []).map((agent) => [agent.id, agent.name || agent.id]));
  agentNames.set("default", agentNames.get("default") || "Global");

  return facts
    .filter((fact) => fact.factType === "run" && (fact.status === "started" || fact.status === "waiting"))
    .map((fact) => {
      const botId = fact.botId || "";
      const bot = botDetails.get(`${fact.channel}\0${botId}`);
      const agentId = bot?.agentId || "default";
      const startedAt = fact.startedAt || fact.createdAt;
      const durationMs = Math.max(0, nowMs - Date.parse(startedAt));
      const isLive = live.has(`${fact.channel}\0${botId}\0${fact.chatId}\0${fact.sessionId}`);
      return {
        runId: fact.runId,
        agentId,
        agentName: agentNames.get(agentId) || agentId,
        channel: fact.channel,
        botId,
        botName: bot?.name || botId || "unknown",
        chatId: fact.chatId,
        sessionId: fact.sessionId,
        status: isLive ? (durationMs >= STUCK_AFTER_MS ? "stuck" as const : "running" as const) : "orphan" as const,
        startedAt,
        durationMs,
        taskPreview: typeof fact.payload.taskPreview === "string" ? fact.payload.taskPreview : ""
      };
    })
    .sort((a, b) => b.durationMs - a.durationMs);
}
