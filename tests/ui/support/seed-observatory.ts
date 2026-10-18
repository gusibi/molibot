import { resolve, join } from "node:path";
import { AiUsageTracker } from "../../../src/lib/server/usage/tracker.js";
import { SqliteTraceStore } from "../../../src/lib/server/agent/hooks/traceStore.js";
import { storagePaths } from "../../../src/lib/server/infra/db/storage.js";
import { assertIsolatedDataDir, isInsideDir } from "./guard.js";

const dataDir = process.env.DATA_DIR ?? "";
assertIsolatedDataDir(dataDir, "analytics seed");
if (resolve(dataDir) !== storagePaths.dataDir || !isInsideDir(dataDir, storagePaths.settingsDbFile)) throw new Error("Analytics seed storage escapes the isolated instance.");
const tracker = new AiUsageTracker({ usageDir: join(dataDir, "usage") });
const store = new SqliteTraceStore(storagePaths.settingsDbFile);
try {
  const statuses = [...Array(17).fill("success"), ...Array(3).fill("error"), "started", "waiting", "aborted", "blocked"] as const;
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    const agentId = i === 0 ? undefined : i < 12 ? "default" : "ui-second";
    const model = i < 12 ? "analysis-model" : "fast-model";
    const usage = status === "success" ? { inputTokens: 100, cacheReadTokens: 30, cacheWriteTokens: 5, outputTokens: 2, totalTokens: 137 } : { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0 };
    if (status === "success" || status === "error") tracker.record({ requestId: `analytics-${i}`, channel: i < 12 ? "web" : "feishu", botId: "analytics-bot", agentId, provider: "local", model, api: "chat", status, ...usage });
    const now = new Date().toISOString();
    store.upsertFact({ id: `analytics-${i}`, factId: `analytics-${i}`, factType: "model_call", runId: `analytics-run-${i}`, sessionId: "analytics-session", channel: i < 12 ? "web" : "feishu", botId: "analytics-bot", provider: "local", model, api: "chat", chatId: "analytics-chat", status, ...usage, payload: { agentId, ...(status === "success" ? { estimatedCostUsd: 0.01 } : {}) }, createdAt: now, updatedAt: now });
  }
  if (process.argv.includes("--more-models")) {
    for (let i = 0; i < 9; i++) tracker.record({ requestId: `analytics-extra-${i}`, channel: "web", botId: "analytics-bot", provider: "local", model: `extra-model-${i}`, api: "chat", status: "error" });
  }
  const now = new Date().toISOString();
  const source = { runId: "analytics-tools", sessionId: "analytics-session", channel: "web", botId: "analytics-bot", chatId: "analytics-chat", createdAt: now, updatedAt: now };
  store.upsertFact({ ...source, id: "analytics-tool", factId: "analytics-tool", factType: "tool_call", name: "read", status: "success", payload: { agentId: "default" } });
  store.upsertFact({ ...source, id: "analytics-mcp", factId: "analytics-mcp", factType: "tool_call", name: "mcp__fixture__query", status: "success", payload: { agentId: "ui-second" } });
  for (const [index, status] of ["success", "success", "success", "error", "waiting"].entries()) {
    store.upsertFact({ ...source, id: `analytics-run-status-${index}`, runId: `analytics-execution-${index}`, factId: `analytics-execution-${index}`, factType: "run", status: status as "success" | "error" | "waiting", payload: { agentId: index < 2 ? "default" : "ui-second" } });
  }
  store.upsertFact({ ...source, id: "analytics-skill", factId: "analytics-skill", factType: "skill_usage", name: "local-research", status: "info", payload: { agentId: "default", level: "executed", scope: "global" } });
} finally { store.close(); }
