import type { TraceReport } from "./report.js";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** A self-contained document: native disclosures work offline and require no executable report data. */
export function renderTraceReport(report: TraceReport, language: "zh" | "en" = "zh"): string {
  const zh = language === "zh";
  const text = zh ? {
    title: "调用链", duration: "总耗时", models: "模型调用", tools: "工具调用", missing: "未记录", partial: "部分用量", snapshot: "快照生成于", input: "输入", output: "输出", read: "缓存读取", write: "缓存写入", args: "参数摘要", result: "结果摘要", error: "错误摘要", started: "开始", finished: "结束", attempt: "重试索引", candidate: "模型候选索引", hint: "点击步骤展开详情。横条表示实际时间范围；缩进表示因果关系，不表示时间包含。未结束的步骤仅在执行进行中显示已持续时间。未记录内部步骤的外部调用仅显示外层。", status: "状态"
  } : {
    title: "Call trace", duration: "Elapsed", models: "Model calls", tools: "Tool calls", missing: "Not recorded", partial: "Partial usage", snapshot: "Snapshot generated", input: "Input", output: "Output", read: "Cache read", write: "Cache write", args: "Arguments preview", result: "Result preview", error: "Error preview", started: "Started", finished: "Finished", attempt: "Retry index", candidate: "Model candidate index", hint: "Expand a step for details. Bars show elapsed time; indentation shows causal relationships, not time containment. Unfinished steps only show elapsed time while the run is active. External calls only show internal steps when recorded.", status: "Status"
  };
  const labels: Record<string, string> = zh ? { run: "本轮执行", model_call: "模型", tool_call: "工具", subagent_task: "子 Agent", approval: "审批", input_enrichment: "输入处理", runtime_notice: "运行事件", skill_usage: "技能", started: "进行中", waiting: "等待中", success: "成功", error: "失败", aborted: "已中断", blocked: "已阻止", info: "信息", warning: "警告" } : {};
  const label = (value: string) => labels[value] ?? value.replaceAll("_", " ");
  const duration = (value?: number) => value === undefined ? text.missing : `${(value / 1000).toFixed(2)} s`;
  const base = Date.parse(report.startedAt ?? report.generatedAt);
  const span = Math.max(report.durationMs ?? 0, 1);
  // A node that never finished only has a live duration while the run is still
  // active. Once the root is terminal, extending it to the snapshot time would
  // invent duration for a span that was never completed.
  const reportActive = report.status === "started" || report.status === "waiting";
  const ordered: Array<{ node: TraceReport["nodes"][number]; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (node: TraceReport["nodes"][number], depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id); ordered.push({ node, depth });
    report.nodes.filter(child => child.parentId === node.id).forEach(child => visit(child, depth + 1));
  };
  report.nodes.filter(node => !node.parentId).forEach(node => visit(node, 0));
  report.nodes.forEach(node => visit(node, 0));
  const rows = ordered.map(({ node, depth }) => {
    const start = node.startedAt ? Date.parse(node.startedAt) : NaN;
    const end = node.finishedAt ? Date.parse(node.finishedAt) : reportActive && (node.status === "started" || node.status === "waiting") ? Date.parse(report.generatedAt) : NaN;
    const known = Number.isFinite(start) && Number.isFinite(end);
    const offset = known ? Math.min(100, Math.max(0, (start - base) / span * 100)) : 0;
    const width = known ? Math.min(100 - offset, Math.max(.3, (end - start) / span * 100)) : 0;
    const fields = [[text.started, node.startedAt], [text.finished, node.finishedAt], [text.input, node.inputTokens], [text.output, node.outputTokens], [text.read, node.cacheReadTokens], [text.write, node.cacheWriteTokens], [text.attempt, node.attemptIndex], [text.candidate, node.candidateIndex], ["Provider", node.provider]];
    return `<details><summary><span class="name" style="padding-inline-start:${Math.min(depth, 8) * 14}px"><small>${escape(label(node.factType))}</small><strong>${escape(node.factType === "run" ? label("run") : node.name ?? label(node.factType))}</strong></span><span class="track"><i class="${escape(node.factType)}" style="margin-left:${offset}%;width:${width}%"></i></span><span class="metric">${escape(duration(node.durationMs ?? (known ? end - start : undefined)))}<small>${escape(label(node.status))}</small></span></summary><section><dl>${fields.filter(([, value]) => value !== undefined).map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join("")}${node.factType === "model_call" ? `<div><dt>Tokens</dt><dd>${escape(node.totalTokens ?? text.missing)}</dd></div>` : ""}</dl>${[[text.args, node.argsPreview], [text.result, node.resultPreview], [text.error, node.errorPreview]].filter(([, value]) => value).map(([key, value]) => `<h3>${escape(key)}</h3><pre>${escape(value)}</pre>`).join("")}</section></details>`;
  }).join("");
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${text.title}</title><style>
:root{color-scheme:light dark;--bg:#fff;--panel:#fafafa;--ink:#171717;--muted:#666;--line:#e6e6e6;--blue:#0070f3;--green:#16804a;--purple:#8e4ec6}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}main{max-width:1180px;margin:0 auto;padding:32px 24px}h1{font-size:28px;letter-spacing:-.04em;margin:0}header p,.hint,small,dt{color:var(--muted)}header p{overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:10px;margin:24px 0}.stats div{padding:18px}.stats strong{display:block;font-size:24px;font-weight:550;font-variant-numeric:tabular-nums}.hint{font-size:12px;margin-bottom:20px}.axis{display:flex;justify-content:space-between;margin:0 110px 8px 34%;color:var(--muted);font-size:11px}details{border-top:1px solid var(--line)}summary{display:grid;grid-template-columns:34% 1fr 100px;align-items:center;gap:10px;padding:12px 4px;cursor:pointer;list-style:none}summary:hover,details[open]{background:var(--panel)}summary:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}.name{min-width:0}.name strong{display:block;font-weight:500;overflow-wrap:anywhere}.name small{font-size:10px;text-transform:uppercase;letter-spacing:.06em}.track{height:22px;background:repeating-linear-gradient(90deg,transparent,transparent calc(25% - 1px),var(--line) 25%)}i{height:12px;display:block;position:relative;top:5px;background:var(--muted);border-radius:3px}i.model_call{background:var(--blue)}i.tool_call{background:var(--green)}i.subagent_task{background:var(--purple)}.metric{text-align:right;font-variant-numeric:tabular-nums;font-size:12px}.metric small{display:block}section{padding:8px 20px 20px}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}dd{margin:2px 0;overflow-wrap:anywhere}dt{font-size:12px}h3{font-size:12px;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--line);padding:12px;border-radius:6px;font-size:12px}footer{margin-top:24px;color:var(--muted);font-size:12px}@media(prefers-color-scheme:dark){:root{--bg:#111;--panel:#191919;--ink:#ededed;--muted:#a1a1a1;--line:#333;--blue:#52a8ff;--green:#62c073;--purple:#bf7af0}}@media(max-width:600px){main{padding:20px 12px}.stats{grid-template-columns:repeat(2,1fr)}.stats div{padding:12px}summary{grid-template-columns:40% 1fr 72px;gap:6px}.axis{margin-left:40%;margin-right:78px}dl{grid-template-columns:1fr 1fr}}
</style></head><body><main><header><h1>${text.title}</h1><p>${escape(report.runId)} · ${escape(label(report.status))}</p></header><div class="stats">${[[text.duration, duration(report.durationMs)], [text.models, report.modelCalls], [text.tools, report.toolCalls], ["Tokens", `${report.totalTokens ?? text.missing}${report.usageComplete ? "" : ` · ${text.partial}`}`]].map(([key, value]) => `<div><small>${escape(key)}</small><strong>${escape(value)}</strong></div>`).join("")}</div><p class="hint">${text.hint}</p><div class="axis"><span>0 s</span><span>${escape(duration(report.durationMs))}</span></div>${rows}<footer>${text.snapshot} ${escape(report.generatedAt)}</footer></main></body></html>`;
}
