import type { TraceReport } from "./report.js";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** A self-contained document: native disclosures work offline and require no executable report data. */
export function renderTraceReport(report: TraceReport, language: "zh" | "en" = "zh", theme: "auto" | "light" | "dark" = "auto"): string {
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
    return `<details><summary><span class="name" style="padding-inline-start:${Math.min(depth, 8) * 12}px"><small>${escape(label(node.factType))}</small><strong>${escape(node.factType === "run" ? label("run") : node.name ?? label(node.factType))}</strong></span><span class="track"><i class="${escape(node.factType)}" style="margin-left:${offset}%;width:${width}%"></i></span><span class="metric">${escape(duration(node.durationMs ?? (known ? end - start : undefined)))}<small>${escape(label(node.status))}</small></span></summary><section><dl>${fields.filter(([, value]) => value !== undefined).map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join("")}${node.factType === "model_call" ? `<div><dt>Tokens</dt><dd>${escape(node.totalTokens ?? text.missing)}</dd></div>` : ""}</dl>${[[text.args, node.argsPreview], [text.result, node.resultPreview], [text.error, node.errorPreview]].filter(([, value]) => value).map(([key, value]) => `<h3>${escape(key)}</h3><pre>${escape(value)}</pre>`).join("")}</section></details>`;
  }).join("");
  return `<!doctype html><html lang="${language}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${text.title}</title><style>
:root{color-scheme:light;
--r-bg:#fff;--r-panel:#f5f5f7;--r-ink:#1d1d1f;--r-muted:#6e6e73;--r-line:rgba(0,0,0,.1);--r-blue:#007aff;--r-green:#248a3d;--r-purple:#8944ab;
--r-d-bg:#1c1c1e;--r-d-panel:#2c2c2e;--r-d-ink:#f5f5f7;--r-d-muted:#98989d;--r-d-line:rgba(255,255,255,.14);--r-d-blue:#0a84ff;--r-d-green:#30d158;--r-d-purple:#bf5af2;
/* The report is a standalone document, but when the app embeds it (sandboxed
   iframe) the drawer injects the live app token values. Every colour therefore
   reads the app's semantic token first and falls back to the built-in palette
   for a published snapshot, so a theme family applies without duplicating the
   ramp on the server. */
--bg:var(--card-bg,var(--r-bg));--panel:var(--surface-secondary,var(--r-panel));--ink:var(--label-primary,var(--r-ink));--muted:var(--label-secondary,var(--r-muted));--line:var(--separator,var(--r-line));--blue:var(--accent,var(--r-blue));--green:var(--online,var(--r-green));--purple:var(--skill-accent,var(--r-purple))}
html[data-theme=dark]{color-scheme:dark;--r-bg:var(--r-d-bg);--r-panel:var(--r-d-panel);--r-ink:var(--r-d-ink);--r-muted:var(--r-d-muted);--r-line:var(--r-d-line);--r-blue:var(--r-d-blue);--r-green:var(--r-d-green);--r-purple:var(--r-d-purple)}
@media(prefers-color-scheme:dark){html[data-theme=auto]{color-scheme:dark;--r-bg:var(--r-d-bg);--r-panel:var(--r-d-panel);--r-ink:var(--r-d-ink);--r-muted:var(--r-d-muted);--r-line:var(--r-d-line);--r-blue:var(--r-d-blue);--r-green:var(--r-d-green);--r-purple:var(--r-d-purple)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif);font-size:var(--fs-body,13px);line-height:1.45}
main{max-width:1180px;margin:0 auto;padding:18px}
h1{font-size:var(--fs-page,20px);letter-spacing:-.02em;margin:0}
header p,.hint,small,dt{color:var(--muted)}
header p{margin:2px 0 0;font-size:var(--fs-meta,12px);overflow-wrap:anywhere}
.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:var(--radius-control,8px);margin:12px 0 10px;overflow:hidden}
.stats div{padding:10px 12px}
.stats small{font-size:var(--fs-meta,11px)}
.stats strong{display:block;margin-top:2px;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.hint{margin:0 0 10px;font-size:var(--fs-meta,11px)}
.axis{display:flex;justify-content:space-between;margin:0 96px 4px 34%;color:var(--muted);font-size:var(--fs-meta,11px)}
details{border-top:1px solid var(--line)}
summary{display:grid;grid-template-columns:34% 1fr 96px;align-items:center;gap:8px;padding:7px 4px;cursor:pointer;list-style:none}
summary:hover,details[open]{background:var(--panel)}
summary:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
.name{min-width:0}
.name strong{display:block;font-size:var(--fs-label,13px);font-weight:500;overflow-wrap:anywhere}
.name small{font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.track{height:18px;background:repeating-linear-gradient(90deg,transparent,transparent calc(25% - 1px),var(--line) 25%)}
i{height:10px;display:block;position:relative;top:4px;background:var(--muted);border-radius:var(--radius-small,3px)}
i.model_call{background:var(--blue)}
i.tool_call{background:var(--green)}
i.subagent_task{background:var(--purple)}
.metric{text-align:right;font-variant-numeric:tabular-nums;font-size:var(--fs-label,12px)}
.metric small{display:block;font-size:10px}
section{padding:6px 12px 12px}
dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
dd{margin:1px 0;font-size:var(--fs-label,12px);overflow-wrap:anywhere}
dt{font-size:var(--fs-meta,11px)}
h3{margin:10px 0 4px;font-size:var(--fs-meta,11px);font-weight:600}
pre{margin:0;padding:8px;border:1px solid var(--syntax-code-border,var(--line));border-radius:var(--radius-control,6px);background:var(--syntax-code-bg,var(--r-panel));color:var(--syntax-code-fg,var(--r-ink));font-family:var(--font-mono,ui-monospace,monospace);font-size:var(--fs-meta,12px);white-space:pre-wrap;overflow-wrap:anywhere}
footer{margin-top:14px;color:var(--muted);font-size:var(--fs-meta,11px)}
@media(max-width:600px){main{padding:14px 10px}
.stats{grid-template-columns:repeat(2,1fr)}
summary{grid-template-columns:40% 1fr 72px;gap:6px}
.axis{margin-left:40%;margin-right:74px}
dl{grid-template-columns:1fr 1fr}
}
</style></head><body><main><header><h1>${text.title}</h1><p>${escape(report.runId)} · ${escape(label(report.status))}</p></header><div class="stats">${[[text.duration, duration(report.durationMs)], [text.models, report.modelCalls], [text.tools, report.toolCalls], ["Tokens", `${report.totalTokens ?? text.missing}${report.usageComplete ? "" : ` · ${text.partial}`}`]].map(([key, value]) => `<div><small>${escape(key)}</small><strong>${escape(value)}</strong></div>`).join("")}</div><p class="hint">${text.hint}</p><div class="axis"><span>0 s</span><span>${escape(duration(report.durationMs))}</span></div>${rows}<footer>${text.snapshot} ${escape(report.generatedAt)}</footer></main></body></html>`;
}
