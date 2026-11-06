import type { TraceReport } from "./report.js";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** A self-contained document: native disclosures work offline and require no executable report data. */
export function renderTraceReport(report: TraceReport, language: "zh" | "en" = "zh", theme: "auto" | "light" | "dark" = "auto"): string {
  const zh = language === "zh";
  const text = zh ? {
    title: "调用链", duration: "总耗时", models: "主模型调用", tools: "工具调用", missing: "未记录", partial: "部分用量", snapshot: "快照生成于", input: "输入", output: "输出", read: "缓存读取", write: "缓存写入", args: "参数摘要", result: "结果摘要", error: "错误摘要", started: "开始", finished: "结束", attempt: "重试索引", candidate: "模型候选索引", stepCol: "执行步骤", durationCol: "耗时", expandHint: "点击步骤展开详情", hint: "点击步骤展开详情。决策模型单独显示为运行事件，不计入主模型调用次数。横条表示实际时间范围；缩进表示因果关系，不表示时间包含。未结束的步骤仅在执行进行中显示已持续时间。未记录内部步骤的外部调用仅显示外层。", status: "状态", turnUsage: "本轮 Token 用量", sessionUsage: "会话累计", rounds: "轮", callsUnit: "次模型调用", hitRate: "命中率", firstPrompt: "首轮上下文", hitRateHint: "命中率 = 缓存读取 ÷ 全部输入（非缓存输入 + 缓存读取 + 缓存写入）", firstPromptHint: "会话首次模型调用的完整提示规模（系统提示词 + 工具定义 + 首条消息），随对话推进它会被缓存复用"
  } : {
    title: "Call trace", duration: "Elapsed", models: "Main model calls", tools: "Tool calls", missing: "Not recorded", partial: "Partial usage", snapshot: "Snapshot generated", input: "Input", output: "Output", read: "Cache read", write: "Cache write", args: "Arguments preview", result: "Result preview", error: "Error preview", started: "Started", finished: "Finished", attempt: "Retry index", candidate: "Model candidate index", stepCol: "Step", durationCol: "Duration", expandHint: "Click a step for details", hint: "Expand a step for details. Decision models appear as separate runtime events and are not counted as main model calls. Bars show elapsed time; indentation shows causal relationships, not time containment. Unfinished steps only show elapsed time while the run is active. External calls only show internal steps when recorded.", status: "Status", turnUsage: "Turn token usage", sessionUsage: "Session total", rounds: "runs", callsUnit: "model calls", hitRate: "Hit rate", firstPrompt: "First prompt", hitRateHint: "Hit rate = cache read / full prompt input (uncached input + cache read + cache write)", firstPromptHint: "Full prompt size of the session's first model call (system prompt + tool schemas + first message); later calls reuse it from cache"
  };
  const labels: Record<string, string> = zh ? { run: "本轮执行", model_call: "模型", tool_call: "工具", subagent_task: "子 Agent", approval: "审批", input_enrichment: "输入处理", runtime_notice: "运行事件", skill_usage: "技能", started: "进行中", waiting: "等待中", success: "成功", error: "失败", aborted: "已中断", blocked: "已阻止", info: "信息", warning: "警告" } : {};
  const label = (value: string) => labels[value] ?? value.replaceAll("_", " ");
  const thinkingLevel = (value?: string) => value ? (zh ? { off: "关", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高" }[value] ?? value : value) : undefined;
  const decisionReason = (value?: string) => value ? (zh ? ({
    fixed_strategy: "使用固定强度", disabled: "决策模型未启用", missing_model: "未选择决策模型",
    missing_credential: "决策模型凭据缺失", invalid_configuration: "决策模型配置错误",
    timeout: "决策超时", network_error: "决策请求失败", malformed_response: "决策结果格式错误",
    invalid_confidence: "决策置信度无效", low_confidence: "决策置信度不足",
    insufficient_context: "决策上下文不足"
  } as Record<string, string>)[value] ?? value : value.replaceAll("_", " ")) : undefined;
  const duration = (value?: number) => value === undefined ? text.missing : `${(value / 1000).toFixed(2)} s`;
  // Compact K/M so big token counts stay readable at a glance; exact values
  // ride the title attribute for hover. Mirrors the app's formatCompactTokens.
  const compactTokens = (value: number): string => {
    const n = Math.max(0, Math.round(value));
    if (n < 1_000) return String(n);
    if (n < 1_000_000) {
      const k = n / 1_000;
      return `${k >= 100 || n % 1_000 === 0 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
    }
    const m = n / 1_000_000;
    return `${m >= 100 || n % 1_000_000 === 0 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}m`;
  };
  const formatTokens = (value: number | null | undefined) => value === null || value === undefined ? text.missing : compactTokens(value);
  const exactTokens = (value: number | null | undefined) => value === null || value === undefined ? undefined : value.toLocaleString("en-US");
  const formatRate = (rate: number | null | undefined) => rate === null || rate === undefined ? undefined : `${Math.round(rate * 100)}%`;
  const rateClass = (rate: number | null | undefined) => rate === null || rate === undefined ? "" : rate >= 0.7 ? " rate-good" : rate < 0.3 ? " rate-low" : "";
  // One stacked segment per non-zero token bucket; widths are shares of the turn total.
  const tokenBar = (tokens: TraceReport["tokens"]): string => {
    const total = tokens.total;
    if (total <= 0) return "";
    const segments = [["seg-read", tokens.cacheRead], ["seg-write", tokens.cacheWrite], ["seg-input", tokens.input], ["seg-output", tokens.output]] as const;
    return `<div class="token-bar">${segments.filter(([, value]) => value > 0).map(([kind, value]) => `<i class="${kind}" style="width:${Math.max(1, Math.round(value / total * 100))}%"></i>`).join("")}</div>`;
  };
  const legendToken = (kind: "read" | "write" | "input" | "output", label: string, value: number) => `<span class="tok tok-${kind}">${escape(label)} <b title="${escape(exactTokens(value) ?? "")}">${escape(compactTokens(value))}</b></span>`;
  const tokensPanel = (() => {
    const turn = report.tokens;
    const session = report.session;
    const turnRecorded = turn.total > 0;
    const parts: string[] = [`<div class="tokens-panel"><div class="tokens-title">${escape(text.turnUsage)}</div>`];
    if (turnRecorded) {
      parts.push(tokenBar(turn));
      parts.push(`<div class="token-legend">${legendToken("read", text.read, turn.cacheRead)}${legendToken("write", text.write, turn.cacheWrite)}${legendToken("input", text.input, turn.input)}${legendToken("output", text.output, turn.output)}${formatRate(turn.hitRate) !== undefined ? `<span class="tok-hit" title="${escape(text.hitRateHint)}">${escape(text.hitRate)} <b class="rate${rateClass(turn.hitRate)}">${escape(formatRate(turn.hitRate)!)}</b></span>` : ""}</div>`);
    } else {
      parts.push(`<div class="token-empty">${escape(text.missing)}</div>`);
    }
    if (session.modelCalls > 0) {
      const sessionRate = formatRate(session.tokens.hitRate);
      parts.push(`<div class="session-line"><span class="session-label">${escape(text.sessionUsage)}</span><span>${escape(String(session.runs))} ${escape(text.rounds)} · ${escape(String(session.modelCalls))} ${escape(text.callsUnit)}</span><span>Tokens <b title="${escape(exactTokens(session.tokens.total) ?? "")}">${escape(compactTokens(session.tokens.total))}</b></span>${legendToken("read", text.read, session.tokens.cacheRead)}${legendToken("write", text.write, session.tokens.cacheWrite)}${legendToken("input", text.input, session.tokens.input)}${legendToken("output", text.output, session.tokens.output)}${sessionRate !== undefined ? `<span title="${escape(text.hitRateHint)}">${escape(text.hitRate)} <b class="rate${rateClass(session.tokens.hitRate)}">${escape(sessionRate)}</b></span>` : ""}${session.firstPromptTokens ? `<span title="${escape(text.firstPromptHint)}">${escape(text.firstPrompt)} <b title="${escape(exactTokens(session.firstPromptTokens) ?? "")}">${escape(compactTokens(session.firstPromptTokens))}</b></span>` : ""}</div>`);
    }
    parts.push("</div>");
    return parts.join("");
  })();
  const statsHtml = `<div><small>${escape(text.duration)}</small><strong>${escape(duration(report.durationMs))}</strong></div><div><small>${escape(text.models)}</small><strong>${escape(String(report.modelCalls))}</strong></div><div><small>${escape(text.tools)}</small><strong>${escape(String(report.toolCalls))}</strong></div><div><small>Tokens${report.usageComplete ? "" : ` · ${escape(text.partial)}`}</small><strong${report.tokens.total > 0 ? ` title="${escape(exactTokens(report.tokens.total))}"` : ""}>${escape(report.tokens.total > 0 ? compactTokens(report.tokens.total) : text.missing)}</strong></div>`;
  // The report renders on the same machine that serves the app, so local wall
  // time is the user's time; published snapshots freeze it at publish time.
  const formatStamp = (value?: string) => {
    if (!value) return undefined;
    const time = Date.parse(value);
    if (Number.isNaN(time)) return value;
    const at = new Date(time);
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  };
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
    const isDecision = node.factType === "runtime_notice" && node.name === "decision_model.thinking_level";
    const decisionLabel = zh ? "决策模型" : "Decision model";
    const kicker = isDecision ? decisionLabel : label(node.factType);
    const name = isDecision
      ? `${decisionLabel} · ${node.decisionStatus === "skipped" ? (zh ? "已跳过" : "Skipped") : thinkingLevel(node.thinkingLevel) ?? text.missing}`
      : node.factType === "model_call" && node.thinkingLevel
        ? `${node.name ?? kicker} · ${thinkingLevel(node.thinkingLevel)}`
        // A run node's raw name is the session id; the row reads as the run itself.
        : node.factType === "run" ? kicker : node.name ?? kicker;
    const fieldTitle = (value: number | undefined) => value === undefined ? "" : ` title="${escape(value.toLocaleString("en-US"))}"`;
    const fields = [[text.started, formatStamp(node.startedAt), ""], [text.finished, formatStamp(node.finishedAt), ""], [text.input, node.inputTokens !== undefined ? formatTokens(node.inputTokens) : undefined, fieldTitle(node.inputTokens)], [text.output, node.outputTokens !== undefined ? formatTokens(node.outputTokens) : undefined, fieldTitle(node.outputTokens)], [text.read, node.cacheReadTokens !== undefined ? formatTokens(node.cacheReadTokens) : undefined, fieldTitle(node.cacheReadTokens)], [text.write, node.cacheWriteTokens !== undefined ? formatTokens(node.cacheWriteTokens) : undefined, fieldTitle(node.cacheWriteTokens)], [text.attempt, node.attemptIndex, ""], [text.candidate, node.candidateIndex, ""], ["Provider", node.provider, ""], ...(isDecision ? [[zh ? "决策模型" : "Decision model", node.decisionModel, ""], [zh ? "决策结果" : "Decision result", thinkingLevel(node.thinkingLevel), ""], [zh ? "原因" : "Reason", decisionReason(node.fallbackReason), ""]] : [])] as Array<[string, string | number | undefined, string]>;
    return `<details><summary data-kind="${escape(node.factType)}"><span class="name" style="padding-inline-start:${Math.min(depth, 8) * 8}px">${kicker === name ? "" : `<small class="kind kind-${escape(node.factType)}">${escape(kicker)}</small>`}<strong>${escape(name)}</strong></span><span class="track"><i class="${escape(node.factType)}" style="margin-left:${offset}%;width:${width}%"></i></span><span class="metric">${escape(duration(node.durationMs ?? (known ? end - start : undefined)))}<small data-status="${escape(node.status)}">${escape(label(node.status))}</small></span></summary><section><dl>${fields.filter(([, value]) => value !== undefined).map(([key, value, title]) => `<div><dt>${escape(key)}</dt><dd${title}>${escape(value)}</dd></div>`).join("")}${node.factType === "model_call" ? `<div><dt>Tokens</dt><dd${fieldTitle(node.totalTokens)}>${escape(formatTokens(node.totalTokens))}</dd></div>` : ""}</dl>${[[text.args, node.argsPreview], [text.result, node.resultPreview], [text.error, node.errorPreview]].filter(([, value]) => value).map(([key, value]) => `<h3>${escape(key)}</h3><pre>${escape(value)}</pre>`).join("")}</section></details>`;
  }).join("");
  const midDuration = report.durationMs !== undefined ? duration(report.durationMs / 2) : "";
  return `<!doctype html><html lang="${language}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${text.title}</title><style>
:root{color-scheme:light;
--r-bg:#fff;--r-panel:#f6f6f8;--r-ink:#171717;--r-muted:#6e6e73;--r-subtle:#8e8e93;--r-line:rgba(0,0,0,.08);--r-hairline:rgba(0,0,0,.05);--r-fill:rgba(0,0,0,.04);--r-blue:#006bff;--r-green:#248a3d;--r-purple:#8944ab;--r-danger:#d92d20;--r-warn:#b54708;
--r-d-bg:#18181a;--r-d-panel:#222225;--r-d-ink:#f5f5f7;--r-d-muted:#98989d;--r-d-subtle:#6e6e73;--r-d-line:rgba(255,255,255,.1);--r-d-hairline:rgba(255,255,255,.06);--r-d-fill:rgba(255,255,255,.05);--r-d-blue:#0a84ff;--r-d-green:#30d158;--r-d-purple:#bf5af2;--r-d-danger:#ff453a;--r-d-warn:#ff9f0a;
/* The report is a standalone document, but when the app embeds it (sandboxed
   iframe) the drawer injects the live app token values. Every colour therefore
   reads the app's semantic token first and falls back to the built-in palette
   for a published snapshot, so a theme family applies without duplicating the
   ramp on the server. */
--bg:var(--card-bg,var(--r-bg));--panel:var(--surface-secondary,var(--r-panel));--ink:var(--label-primary,var(--r-ink));--muted:var(--label-secondary,var(--r-muted));--subtle:var(--label-tertiary,var(--r-subtle));--line:var(--separator,var(--r-line));--hairline:var(--hairline,var(--r-hairline));--fill:var(--fill,var(--r-fill));--blue:var(--accent,var(--r-blue));--green:var(--online,var(--r-green));--purple:var(--skill-accent,var(--r-purple));--danger:var(--danger,var(--r-danger));--warn:var(--warning,var(--r-warn))}
html[data-theme=dark]{color-scheme:dark;--r-bg:var(--r-d-bg);--r-panel:var(--r-d-panel);--r-ink:var(--r-d-ink);--r-muted:var(--r-d-muted);--r-subtle:var(--r-d-subtle);--r-line:var(--r-d-line);--r-hairline:var(--r-d-hairline);--r-fill:var(--r-d-fill);--r-blue:var(--r-d-blue);--r-green:var(--r-d-green);--r-purple:var(--r-d-purple);--r-danger:var(--r-d-danger);--r-warn:var(--r-d-warn)}
@media(prefers-color-scheme:dark){html[data-theme=auto]{color-scheme:dark;--r-bg:var(--r-d-bg);--r-panel:var(--r-d-panel);--r-ink:var(--r-d-ink);--r-muted:var(--r-d-muted);--r-subtle:var(--r-d-subtle);--r-line:var(--r-d-line);--r-hairline:var(--r-d-hairline);--r-fill:var(--r-d-fill);--r-blue:var(--r-d-blue);--r-green:var(--r-d-green);--r-purple:var(--r-d-purple);--r-danger:var(--r-d-danger);--r-warn:var(--r-d-warn)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif);font-size:var(--fs-body,13px);line-height:var(--lh-body,1.5);-webkit-font-smoothing:antialiased}
main{max-width:1180px;margin:0 auto;padding:20px}
h1{font-size:var(--fs-page,20px);line-height:var(--lh-page,26px);letter-spacing:-.02em;margin:0 0 8px}
header p{ display:flex;align-items:center;gap:8px;margin:0;min-width:0;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
.status-pill{display:inline-flex;align-items:center;gap:5px;flex:none;height:20px;padding:0 8px;border-radius:999px;background:var(--fill);color:var(--ink);font-size:var(--fs-meta,11px);font-weight:600}
.status-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--muted)}
.status-pill[data-status=success]{background:color-mix(in srgb,var(--green) 12%,transparent);color:var(--green)}
.status-pill[data-status=success]::before{background:var(--green)}
.status-pill[data-status=started],.status-pill[data-status=waiting]{background:color-mix(in srgb,var(--blue) 12%,transparent);color:var(--blue)}
.status-pill[data-status=started]::before,.status-pill[data-status=waiting]::before{background:var(--blue)}
.status-pill[data-status=error],.status-pill[data-status=aborted],.status-pill[data-status=blocked]{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger)}
.status-pill[data-status=error]::before,.status-pill[data-status=aborted]::before,.status-pill[data-status=blocked]::before{background:var(--danger)}
.run-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono,ui-monospace,monospace);font-size:var(--fs-meta,11px);color:var(--subtle)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-radius:var(--radius-panel,10px);background:var(--panel);margin:12px 0;overflow:hidden}
.stats div{padding:11px 14px;border-right:1px solid var(--line)}
.stats div:last-child{border-right:0}
.stats small{display:block;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
.stats strong{display:block;margin-top:3px;font-size:17px;line-height:22px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tokens-panel{border:1px solid var(--line);border-radius:var(--radius-panel,10px);background:var(--panel);margin:12px 0;padding:10px 14px 11px}
.tokens-title{color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-weight:600}
.token-bar{display:flex;gap:2px;height:8px;margin-top:8px;border-radius:999px;overflow:hidden;background:var(--fill)}
.token-bar i{display:block;height:100%;min-width:3px;border-radius:0}
.token-bar i.seg-read{background:var(--blue)}
.token-bar i.seg-write{background:var(--purple)}
.token-bar i.seg-input{background:var(--muted)}
.token-bar i.seg-output{background:var(--green)}
.token-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:9px;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-variant-numeric:tabular-nums}
.tok{display:inline-flex;align-items:center;gap:5px}
.tok::before{content:"";width:7px;height:7px;border-radius:999px;background:var(--muted)}
.tok-read::before{background:var(--blue)}
.tok-write::before{background:var(--purple)}
.tok-input::before{background:var(--muted)}
.tok-output::before{background:var(--green)}
.tok b,.session-line b{font-weight:500;color:var(--ink);font-family:var(--font-mono,ui-monospace,monospace)}
.tok-hit{margin-left:auto}
b.rate-good{color:var(--green)}
b.rate-low{color:var(--warn)}
.token-empty{margin-top:7px;color:var(--subtle);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
.session-line{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;margin-top:10px;padding-top:9px;border-top:1px solid var(--line);color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-variant-numeric:tabular-nums}
.session-label{font-weight:600;color:var(--ink)}
.legend-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;margin:0 0 8px;padding:0 2px;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
.legend-items{display:inline-flex;align-items:center;flex-wrap:wrap;gap:12px}
.legend-dot{display:inline-flex;align-items:center;gap:5px}
.legend-dot::before{content:"";width:7px;height:7px;border-radius:999px;background:var(--muted)}
.legend-dot.model_call::before{background:var(--blue)}
.legend-dot.tool_call::before{background:var(--green)}
.legend-dot.subagent_task::before{background:var(--purple)}
.hint{margin:0;color:var(--subtle);font-size:var(--fs-meta,11px);cursor:help;border-bottom:1px dotted var(--line)}
.waterfall{border:1px solid var(--line);border-radius:var(--radius-panel,10px);background:var(--bg);overflow:hidden}
.axis,summary{display:grid;grid-template-columns:minmax(248px,52%) minmax(100px,1fr) 54px;align-items:center;gap:10px;padding:8px 12px}
.axis{padding-block:6px;background:var(--panel);border-bottom:1px solid var(--line);color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-weight:500}
.axis-scale{display:flex;justify-content:space-between;font-family:var(--font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:var(--subtle)}
.axis-dur{text-align:right}
details{border-top:1px solid var(--hairline)}
.axis+details{border-top:0}
summary{min-height:36px;cursor:pointer;list-style:none;transition:background 120ms ease}
summary::-webkit-details-marker{display:none}
summary:hover{background:var(--fill)}
details[open]>summary{background:var(--panel);border-bottom:1px solid var(--hairline)}
summary:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
.name{display:flex;flex-direction:row;align-items:center;gap:6px;min-width:0}
.name::before{content:"›";flex:none;display:inline-block;width:10px;text-align:center;color:var(--subtle);font-size:13px;line-height:1;transition:transform 140ms ease,color 140ms ease}
details[open]>summary .name::before{transform:rotate(90deg);color:var(--ink)}
.name strong{flex:1;min-width:0;font-size:var(--fs-label,13px);line-height:var(--lh-label,18px);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
summary[data-kind=run] .name strong{font-weight:600}
summary[data-kind=model_call] .name strong,summary[data-kind=tool_call] .name strong{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px}
.name small.kind{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;background:var(--fill);color:var(--muted);font-size:var(--fs-meta,11px);line-height:18px;font-weight:500}
.name small.kind-model_call{background:color-mix(in srgb,var(--blue) 11%,transparent);color:var(--blue)}
.name small.kind-tool_call{background:color-mix(in srgb,var(--green) 11%,transparent);color:var(--green)}
.name small.kind-subagent_task{background:color-mix(in srgb,var(--purple) 11%,transparent);color:var(--purple)}
.track{position:relative;height:7px;border-radius:999px;background:var(--fill);overflow:hidden}
i{height:100%;min-width:6px;display:block;position:relative;top:0;background:var(--muted);border-radius:999px}
i[style*="width:0%"]{min-width:0}
i.model_call{background:var(--blue)}
i.tool_call{background:var(--green)}
i.subagent_task{background:var(--purple)}
.metric{text-align:right;font-family:var(--font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:var(--fs-meta,11px);line-height:16px;color:var(--muted);white-space:nowrap}
summary[data-kind=run] .metric{color:var(--ink);font-weight:600}
.metric small{display:block;font-family:var(--font-ui,-apple-system,sans-serif);font-size:var(--fs-meta,11px);line-height:14px;color:var(--subtle)}
.metric small[data-status=success]{display:none}
.metric small[data-status=error],.metric small[data-status=aborted],.metric small[data-status=blocked]{color:var(--danger)}
section{margin:10px 12px 12px 24px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius-control,8px);background:var(--panel)}
dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;margin:0}
dd{margin:2px 0 0;font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-family:var(--font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;color:var(--ink)}
dt{color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
h3{margin:10px 0 4px;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-weight:600}
pre{margin:0;max-height:220px;overflow:auto;padding:8px 10px;border:1px solid var(--syntax-code-border,var(--line));border-radius:var(--radius-control,6px);background:var(--syntax-code-bg,var(--r-bg));color:var(--syntax-code-fg,var(--r-ink));font-family:var(--font-mono,ui-monospace,monospace);font-size:var(--fs-meta,11px);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
footer{margin-top:12px;padding:0 2px;color:var(--subtle);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-variant-numeric:tabular-nums}
@media(max-width:440px){main{padding:12px 10px}
.stats{grid-template-columns:repeat(2,minmax(0,1fr))}
.stats div:nth-child(2){border-right:0}
.stats div:nth-child(-n+2){border-bottom:1px solid var(--line)}
.axis,summary{grid-template-columns:minmax(130px,42%) minmax(0,1fr) 68px;gap:8px;padding-inline:8px}
dl{grid-template-columns:1fr 1fr}
}
</style></head><body><main><header><h1>${text.title}</h1><p><span class="status-pill" data-status="${escape(report.status)}">${escape(label(report.status))}</span><span class="run-id" title="${escape(report.runId)}">${escape(report.runId)}</span></p></header><div class="stats">${statsHtml}</div>${tokensPanel}<div class="legend-bar"><span class="legend-items"><span class="legend-dot run">${escape(label("run"))}</span><span class="legend-dot model_call">${escape(label("model_call"))}</span><span class="legend-dot tool_call">${escape(label("tool_call"))}</span><span class="legend-dot subagent_task">${escape(label("subagent_task"))}</span></span><p class="hint" title="${escape(text.hint)}">${escape(text.expandHint)}</p></div><div class="waterfall"><div class="axis"><span>${escape(text.stepCol)}</span><span class="axis-scale"><span>0 s</span>${midDuration ? `<span>${escape(midDuration)}</span>` : ""}<span>${escape(duration(report.durationMs))}</span></span><span class="axis-dur">${escape(text.durationCol)}</span></div>${rows}</div><footer>${text.snapshot} ${escape(formatStamp(report.generatedAt))}</footer></main></body></html>`;
}
