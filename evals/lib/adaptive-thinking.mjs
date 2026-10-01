import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ADAPTIVE_EVAL_VERSION = "adaptive-thinking-v1";
const task = (id, title, category, prompts, assertions, files) => ({
  id, title, category, turns: prompts.map((prompt, index) => ({ prompt, ...(files && index === 0 ? { files } : {}) })), assertions
});
export const adaptiveTasks = [
  task("AT01", "English routine translation", "simple", ["Translate only: 今天下雨了。"], [{ reply_contains_any: ["rain", "raining"] }]),
  task("AT02", "中文简单计算", "simple", ["只输出 17 × 23 的结果。"], [{ reply_matches: "^\\s*391[。.!]?\\s*$" }]),
  task("AT03", "Short English race diagnosis", "diagnosis", ["A stale fetch replaces a newer session after switching tabs. Identify the race and give a shared-layer fix with a regression test."], [{ reply_contains_any: ["stale", "generation", "request", "race"] }, { reply_contains_any: ["test", "assert"] }]),
  task("AT04", "中文跨层诊断", "diagnosis", ["取消后队列又执行了同一任务，重启后再次重复。设计共享层的幂等修复并给出回归测试，说明取消、恢复、完成时的状态转换。"], [{ reply_contains: ["幂等", "取消", "测试"] }]),
  task("AT05", "English follow-up with antecedent", "followup", ["Explain a three-step plan for verifying a stale asynchronous fetch bug without external tools.", "Continue."], [{ reply_not_contains: ["cannot continue without", "no context"] }]),
  task("AT06", "无前文中文续写", "missing-context", ["继续"], [{ reply_contains_any: ["什么", "内容", "上下文", "继续哪", "提供"] }]),
  task("AT07", "Attachment outcome", "attachment", ["Read the attached CSV and report the exact sum of the amount column."], [{ reply_contains: "448.4" }], ["eval-expenses.csv"]),
  task("AT08", "Long routine context", "long-context", ["Return only the final marker.\n" + "This is filler, not a request for reasoning.\n".repeat(300) + "Final marker: BLUE-314"], [{ reply_contains: "BLUE-314" }]),
  task("AT09", "Long Chinese interacting constraints", "long-context", ["以下是无关日志：\n" + "正常心跳，连接正常。\n".repeat(400) + "真正问题：取消任务后旧回调写入已切换会话，恢复又重复执行。请分析状态机、请求代际和持久化幂等的联合修复及测试。"], [{ reply_contains_any: ["幂等", "代际", "状态机"] }, { reply_contains: "测试" }])
];

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}

export function summarizeAdaptiveSamples(samples) {
  return Object.fromEntries(["fixed", "auto"].map(mode => {
    const rows = samples.filter(row => row.mode === mode);
    const timing = field => ({ p50: percentile(rows.map(row => row[field]), 0.5), p95: percentile(rows.map(row => row[field]), 0.95) });
    return [mode, { samples: rows.length, passRate: rows.length ? rows.filter(row => row.status === "pass").length / rows.length : null,
      endToEndMs: timing("endToEndMs"), decisionMs: timing("decisionMs"), firstVisibleMs: timing("firstVisibleMs"),
      totalCost: rows.length && rows.every(row => Number.isFinite(row.totalCost)) ? rows.reduce((sum, row) => sum + row.totalCost, 0) : null, costStatus: rows.length && rows.every(row => Number.isFinite(row.totalCost)) ? "measured estimates" : "unproven: one or more main/decision costs unavailable", retries: null,
      fallbackCount: rows.filter(row => row.fallbackReasons?.length).length,
      capabilityAdjustmentCount: rows.filter(row => row.capabilityAdjustments?.length).length }];
  }));
}

export function readAdaptiveTrace(dataDir, sessionIds, { mode } = {}) {
  const facts = [];
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".sqlite")) {
        let db;
        try {
          db = new DatabaseSync(file, { readOnly: true });
          if (!db.prepare("SELECT name FROM sqlite_master WHERE name='agent_trace_facts'").get()) continue;
          for (const id of sessionIds) facts.push(...db.prepare("SELECT fact_type, name, status, payload_json FROM agent_trace_facts WHERE session_id=?").all(id));
        } finally { db?.close(); }
      }
    }
  };
  walk(dataDir);
  const payloads = facts.map(fact => ({ ...fact, payload: JSON.parse(fact.payload_json) }));
  const decisions = payloads.filter(row => row.payload.code === "decision_model.thinking_level");
  const calls = payloads.filter(row => row.fact_type === "model_call");
  return { traceAvailable: facts.length > 0,
    decisionMs: decisions.length && decisions.every(row => Number.isFinite(row.payload.latencyMs)) ? decisions.reduce((sum, row) => sum + row.payload.latencyMs, 0) : null,
    fallbackReasons: decisions.flatMap(row => row.payload.fallbackReason ? [row.payload.fallbackReason] : []),
    capabilityAdjustments: calls.flatMap(row => row.payload.requestedThinkingLevel !== undefined && row.payload.effectiveThinkingLevel !== undefined && row.payload.requestedThinkingLevel !== row.payload.effectiveThinkingLevel ? [{ requested: row.payload.requestedThinkingLevel, effective: row.payload.effectiveThinkingLevel }] : []),
    modelCalls: calls.length || null,
    mainModelUsage: calls.flatMap(row => row.payload.usage && typeof row.payload.usage === "object" ? [row.payload.usage] : []),
    availableMainModelCost: calls.length && calls.every(row => Number.isFinite(row.payload.usage?.cost?.total))
      ? calls.reduce((sum, row) => sum + row.payload.usage.cost.total, 0) : null,
    decisionUsage: decisions.map(row => row.payload.usage ?? null),
    availableDecisionCost: decisions.length && decisions.every(row => Number.isFinite(row.payload.estimatedCost)) ? decisions.reduce((sum, row) => sum + row.payload.estimatedCost, 0) : null,
    retries: null, totalCost: (mode !== "auto" || decisions.length > 0) && calls.length && calls.every(row => Number.isFinite(row.payload.usage?.cost?.total))
      && decisions.every(row => row.payload.attempted === false || Number.isFinite(row.payload.estimatedCost))
      ? calls.reduce((sum, row) => sum + row.payload.usage.cost.total, 0) + decisions.reduce((sum, row) => sum + (row.payload.estimatedCost ?? 0), 0) : null, firstVisibleMs: null,
    measurementsUnproven: ["first-visible latency: nonstream chat API", "retry count: no explicit trace field", "total cost is unproven whenever main/decision cost is missing; Jev has no supplied pricing"] };
}
