import { createHash } from "node:crypto";
import type { SqliteTraceStore, TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";

export interface TraceScope { channel: string; botId?: string; chatId: string; sessionId: string }
export interface TraceTarget { runId?: string; messageId?: string; beforeRunId?: string }
export interface TraceNode {
  id: string;
  parentId?: string;
  /** Internal fact key. Present on trusted reports, dropped from public projections. */
  factId?: string;
  factType: TraceFactRecord["factType"];
  name?: string;
  provider?: string;
  model?: string;
  status: TraceFactRecord["status"];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  argsPreview?: string;
  resultPreview?: string;
  errorPreview?: string;
  attemptIndex?: number;
  candidateIndex?: number;
}
export interface TraceReport {
  version: 1;
  generatedAt: string;
  runId: string;
  status: string;
  startedAt?: string;
  durationMs?: number;
  modelCalls: number;
  toolCalls: number;
  totalTokens: number | null;
  usageComplete: boolean;
  nodes: TraceNode[];
}

/** Scope is supplied by the authenticated host or the executing tool, never by the model. */
export function queryTraceReport(store: SqliteTraceStore, target: TraceTarget, scope?: TraceScope, now = new Date()): TraceReport {
  const matches = (fact: TraceFactRecord) => !scope || (fact.channel === scope.channel && fact.botId === scope.botId && fact.chatId === scope.chatId && fact.sessionId === scope.sessionId);
  let runId = target.runId;
  if (!runId) {
    if (!scope) throw new Error("A conversation scope is required.");
    const runs = store.listFactsBySessionId(scope.sessionId).filter(f => f.factType === "run" && matches(f));
    if (target.messageId) {
      const matched = runs.filter(run => store.listByRunId(run.runId).some(event => (event.stage === "run.beforeStart" || event.stage === "reply.delivered") && String(event.payload.messageId) === target.messageId));
      if (matched.length !== 1) throw new Error("Trace not found or message target is ambiguous.");
      runId = matched[0].runId;
    } else {
      const current = runs.find(run => run.runId === target.beforeRunId);
      if (!current) throw new Error("The current run is not recorded yet; specify a run ID.");
      runId = runs[runs.indexOf(current) - 1]?.runId;
    }
  }
  const facts = runId ? store.listFactsByRunId(runId).filter(matches) : [];
  const root = facts.find(f => f.factType === "run");
  if (!root) throw new Error("Trace not found in this conversation.");
  const models = facts.filter(f => f.factType === "model_call");
  const hasUsage = models.some(f => f.totalTokens !== undefined);
  const nodeId = (f: TraceFactRecord) => `${f.runId}:${f.factType}:${f.factId}`;
  const active = root.status === "started" || root.status === "waiting";
  return {
    version: 1, generatedAt: now.toISOString(), runId: root.runId, status: root.status, startedAt: root.startedAt,
    durationMs: active && root.startedAt ? Math.max(0, now.getTime() - Date.parse(root.startedAt)) : root.durationMs,
    modelCalls: models.length, toolCalls: facts.filter(f => f.factType === "tool_call").length,
    totalTokens: hasUsage ? models.reduce((n, f) => n + (f.totalTokens ?? 0), 0) : null,
    usageComplete: models.length > 0 && models.every(f => f.totalTokens !== undefined) && facts.filter(f => f.factType === "subagent_task").every(task => models.some(model => model.parentFactId === `subagent_task:${task.factId}`)),
    nodes: facts.map(f => ({
      id: nodeId(f), parentId: f.factType === "run" ? undefined : f.parentFactId ? `${f.runId}:${f.parentFactId}` : nodeId(root),
      factId: f.factId, factType: f.factType, name: f.name, provider: f.provider, model: f.model,
      status: f.status, startedAt: f.startedAt, finishedAt: f.finishedAt, durationMs: f.durationMs,
      inputTokens: f.inputTokens, outputTokens: f.outputTokens, cacheReadTokens: f.cacheReadTokens, cacheWriteTokens: f.cacheWriteTokens, totalTokens: f.totalTokens,
      argsPreview: f.argsPreview, resultPreview: f.resultPreview, errorPreview: f.errorPreview,
      attemptIndex: typeof f.payload.attemptIndex === "number" ? f.payload.attemptIndex : undefined,
      candidateIndex: typeof f.payload.candidateIndex === "number" ? f.payload.candidateIndex : undefined
    }))
  };
}

/** Public snapshots expose a fixed field whitelist with opaque node and run IDs. Previews, raw fact IDs (which can carry host paths), and host identifiers are dropped. */
export function publicTraceReport(report: TraceReport): TraceReport {
  const publicId = new Map(report.nodes.map((node, index) => [node.id, `node-${index + 1}`]));
  const opaqueRunId = createHash("sha256").update(report.runId).digest("hex").slice(0, 12);
  return {
    ...report,
    runId: `trace-${opaqueRunId}`,
    nodes: report.nodes.map(node => ({
      id: publicId.get(node.id) ?? "",
      parentId: node.parentId ? publicId.get(node.parentId) : undefined,
      factType: node.factType,
      name: node.factType === "run" ? undefined : node.name,
      provider: node.provider,
      model: node.model,
      status: node.status,
      startedAt: node.startedAt,
      finishedAt: node.finishedAt,
      durationMs: node.durationMs,
      inputTokens: node.inputTokens,
      outputTokens: node.outputTokens,
      cacheReadTokens: node.cacheReadTokens,
      cacheWriteTokens: node.cacheWriteTokens,
      totalTokens: node.totalTokens,
      attemptIndex: node.attemptIndex,
      candidateIndex: node.candidateIndex
    }))
  };
}

export function queryTurnTraceReport(store: SqliteTraceStore, runIds: string[], scope?: TraceScope, now = new Date()): TraceReport {
  const ids = [...new Set(runIds)];
  if (!ids.length || ids.length > 100) throw new Error("Select between 1 and 100 recorded runs.");
  const reports = ids.map(runId => queryTraceReport(store, { runId }, scope, now));
  if (reports.length === 1) return reports[0];
  const starts = reports.flatMap(r => r.startedAt ? [Date.parse(r.startedAt)] : []);
  const endTimes = reports.flatMap(r => r.startedAt && r.durationMs !== undefined ? [Date.parse(r.startedAt) + r.durationMs] : []);
  return { ...reports[0], runId: ids.join(", "), startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : undefined,
    durationMs: starts.length === reports.length && endTimes.length === reports.length ? Math.max(...endTimes) - Math.min(...starts) : undefined,
    status: reports.some(r => r.status === "started" || r.status === "waiting") ? "started" : reports.every(r => r.status === "success") ? "success" : "warning",
    totalTokens: reports.some(r => r.totalTokens !== null) ? reports.reduce((n,r) => n + (r.totalTokens ?? 0), 0) : null,
    usageComplete: reports.every(r => r.usageComplete), modelCalls: reports.reduce((n,r) => n+r.modelCalls,0), toolCalls: reports.reduce((n,r) => n+r.toolCalls,0), nodes: reports.flatMap(r => r.nodes)
  };
}
