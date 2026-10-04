import type { AiUsageRecord } from "$lib/server/usage/tracker.js";
import type { SqliteImageTaskStore } from "./imageTaskStore.js";
import { parseModelKey } from "$lib/server/agent/routing/modelRouting.js";

/** Projects committed media tasks; no second charge ledger or replay writes. */
export function readPiImageUsage(store: SqliteImageTaskStore): AiUsageRecord[] {
  return store.getUsageTasks().flatMap(task => {
    if (task.engine !== "pi") return [];
    const model = parseModelKey(task.requestParams?.model ?? "");
    if (model?.mode !== "pi") return [];
    const scope = task.requestParams?.usageScope;
    const usage = task.usage;
    return [{
      ts: task.createdAt, requestId: task.id, channel: scope?.channel ?? "unknown", botId: scope?.botId ?? "unknown",
      agentId: scope?.agentId, roomId: scope?.roomId, sessionId: task.sessionId,
      provider: model.provider, model: model.model, api: "images", capability: "image" as const,
      ...(task.status !== "processing" ? { status: task.status === "completed" ? "success" as const : "error" as const } : {}),
      inputTokens: usage?.input ?? 0, outputTokens: usage?.output ?? 0,
      cacheReadTokens: usage?.cacheRead ?? 0, cacheWriteTokens: usage?.cacheWrite ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      ...(usage ? { estimatedCostUsd: usage.cost.total } : {})
    }];
  });
}
