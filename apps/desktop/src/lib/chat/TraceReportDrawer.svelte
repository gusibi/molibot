<script lang="ts">
  import { onMount } from "svelte";
  import { Portal } from "bits-ui";
  import Button from "../components/ui/Button.svelte";
  import Loader from "reicon-svelte/icons/Loader";
  import Refresh from "reicon-svelte/icons/Refresh";
  import Share from "reicon-svelte/icons/Share";
  import Expand from "reicon-svelte/icons/Expand";
  import ExitFullscreen from "reicon-svelte/icons/ExitFullscreen";
  import X from "reicon-svelte/icons/X";
  import { loadTraceReportHtml, publishTraceReport } from "../api";
  import { session } from "../stores/session.svelte";
  export let endpoint: string;
  export let runIds: string[] = [];
  export let onClose: () => void;
  let html = "";
  let error = "";
  let url = "";
  let busy = false;
  let fullscreen = false;
  let closing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let appearance = "light";
  let themeFamily = "macos";
  let panel: HTMLDivElement | undefined;
  onMount(() => {
    panel?.focus();
    const update = () => {
      appearance = document.documentElement.dataset.resolvedAppearance ?? "light";
      themeFamily = document.documentElement.dataset.themeFamily ?? "macos";
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-resolved-appearance", "data-theme-family", "data-appearance"] });
    return () => { generation++; if (closeTimer) clearTimeout(closeTimer); observer.disconnect(); };
  });
  $: zh = session.locale === "zh-CN";
  $: errorText = friendlyError(error, zh);
  $: if (runIds.length && endpoint) void load(endpoint, runIds, session.locale, appearance === "dark" ? "dark" : "light");
  // The report is a server-rendered document inside a sandboxed iframe, so the
  // parent cannot reach into its document and the report cannot inherit the app
  // stylesheet. Its CSS reads the app's semantic token names with standalone
  // fallbacks, so we inject the live computed values here: every theme family,
  // brightness and type scale then follows the app without duplicating the ramp
  // on the server. The published snapshot keeps the fallback palette.
  const REPORT_TOKENS = [
    "--card-bg", "--surface-secondary", "--label-primary", "--label-secondary", "--label-tertiary",
    "--separator", "--hairline", "--fill", "--fill-hover",
    "--accent", "--online", "--danger", "--warning", "--skill-accent", "--font-ui", "--font-mono",
    "--fs-body", "--lh-body", "--fs-label", "--lh-label", "--fs-meta", "--lh-meta", "--fs-page", "--lh-page",
    "--radius-small", "--radius-control", "--radius-panel",
    "--syntax-code-bg", "--syntax-code-fg", "--syntax-code-border"
  ];
  function reportThemeStyle(family: string): string {
    if (typeof document === "undefined") return "";
    const computed = getComputedStyle(document.documentElement);
    const declarations = REPORT_TOKENS
      .map((name) => `${name}:${computed.getPropertyValue(name).trim()}`)
      .filter((declaration) => !declaration.endsWith(":"))
      .join(";");
    // The drawer already shows the title; the report's own <h1> is the
    // published-snapshot header, so hide the duplicate only while embedded.
    return `<style data-theme-family="${family}">:root{${declarations};--subtle:var(--label-tertiary,#8e8e93);--hairline:var(--separator,rgba(0,0,0,.06));--fill:rgba(127,127,127,.07)}
body{font-size:var(--fs-body,13px);line-height:var(--lh-body,1.5);-webkit-font-smoothing:antialiased}
main{padding:14px 16px 20px}
main>header h1{display:none}
main>header p{display:flex;align-items:center;gap:8px;margin:0;min-width:0;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
.status-pill{display:inline-flex;align-items:center;gap:5px;flex:none;height:20px;padding:0 8px;border-radius:999px;background:var(--fill);color:var(--ink);font-size:var(--fs-meta,11px);font-weight:600}
.status-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--green)}
.run-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono,ui-monospace,monospace);font-size:var(--fs-meta,11px);color:var(--subtle)}
.stats{display:grid !important;grid-template-columns:repeat(4,minmax(0,1fr)) !important;border:1px solid var(--line);border-radius:var(--radius-panel,10px);background:var(--panel);margin:12px 0;overflow:hidden}
.stats div{padding:11px 14px;border-right:1px solid var(--line)}
.stats div:last-child{border-right:0}
.stats small{display:block;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
.stats strong{display:block;margin-top:3px;font-size:17px;line-height:22px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.legend-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;margin:0 0 8px;padding:0 2px;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
.legend-items{display:inline-flex;align-items:center;flex-wrap:wrap;gap:12px}
.legend-dot{display:inline-flex;align-items:center;gap:5px}
.legend-dot::before{content:"";width:7px;height:7px;border-radius:999px;background:var(--muted)}
.legend-dot.model_call::before{background:var(--blue)}
.legend-dot.tool_call::before{background:var(--green)}
.legend-dot.subagent_task::before{background:var(--purple)}
.hint{margin:0;color:var(--subtle);font-size:var(--fs-meta,11px);cursor:help;border-bottom:1px dotted var(--line)}
.waterfall{border:1px solid var(--line);border-radius:var(--radius-panel,10px);background:var(--bg);overflow:hidden}
.axis,summary{display:grid !important;grid-template-columns:minmax(248px,52%) minmax(100px,1fr) 54px !important;align-items:center;gap:10px !important;padding:7px 12px !important;margin:0 !important}
.axis{padding-block:6px !important;background:var(--panel);border-bottom:1px solid var(--line);color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-weight:500}
.axis-scale{display:flex;justify-content:space-between;font-family:var(--font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:var(--subtle)}
.axis-dur{text-align:right}
details{border-top:1px solid var(--line)}
.axis+details{border-top:0}
summary{min-height:36px;cursor:pointer;list-style:none;transition:background 120ms ease}
summary::-webkit-details-marker{display:none}
summary:hover{background:var(--fill)}
details[open]>summary{background:var(--panel);border-bottom:1px solid var(--line)}
.name{display:flex;flex-direction:row;align-items:center;gap:6px;min-width:0}
.name::before{content:"›";flex:none;display:inline-block;width:10px;text-align:center;color:var(--subtle);font-size:13px;line-height:1;transition:transform 140ms ease,color 140ms ease}
details[open]>summary .name::before{transform:rotate(90deg);color:var(--ink)}
.name strong{flex:1;min-width:0;font-size:var(--fs-label,13px);line-height:var(--lh-label,18px);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
summary:has(i.run) .name strong{font-weight:600}
.name small{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;background:var(--fill);color:var(--muted);font-size:var(--fs-meta,11px) !important;line-height:18px;font-weight:500;text-transform:none !important;letter-spacing:0 !important}
summary:has(i.model_call) .name small{background:color-mix(in srgb,var(--blue) 11%,transparent);color:var(--blue)}
summary:has(i.tool_call) .name small{background:color-mix(in srgb,var(--green) 11%,transparent);color:var(--green)}
summary:has(i.subagent_task) .name small{background:color-mix(in srgb,var(--purple) 11%,transparent);color:var(--purple)}
summary:has(i.model_call) .name strong,summary:has(i.tool_call) .name strong{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px}
.track{position:relative;height:7px !important;border-radius:999px;background:var(--fill) !important;overflow:hidden}
i{height:100% !important;min-width:6px;display:block;position:relative;top:0 !important;background:var(--muted);border-radius:999px !important}
i[style*="width:0%"]{min-width:0}
.metric{text-align:right;font-family:var(--font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:var(--fs-meta,11px) !important;line-height:16px;color:var(--muted);white-space:nowrap}
summary:has(i.run) .metric{color:var(--ink);font-weight:600}
.metric small{display:block;font-family:var(--font-ui,-apple-system,sans-serif);font-size:var(--fs-meta,11px) !important;line-height:14px;color:var(--subtle)}
.metric small[data-status=success]{display:none}
section{margin:10px 12px 12px 24px;padding:10px 12px !important;border:1px solid var(--line);border-radius:var(--radius-control,8px);background:var(--panel)}
dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;margin:0}
dd{margin:2px 0 0;font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-family:var(--font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;color:var(--ink)}
dt{color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px)}
h3{margin:10px 0 4px;color:var(--muted);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-weight:600}
pre{margin:0;max-height:220px;overflow:auto;padding:8px 10px;border:1px solid var(--syntax-code-border,var(--line));border-radius:var(--radius-control,6px);background:var(--syntax-code-bg,var(--r-bg));color:var(--syntax-code-fg,var(--r-ink));font-family:var(--font-mono,ui-monospace,monospace);font-size:var(--fs-meta,11px);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
footer{margin-top:12px;padding:0 2px;color:var(--subtle);font-size:var(--fs-meta,11px);line-height:var(--lh-meta,16px);font-variant-numeric:tabular-nums}
</style>`;
  }
  function injectReportTheme(source: string, resolved: string, family: string): string {
    if (!source) return source;
    let themed = source.replace(/data-theme="[^"]*"/, `data-theme="${resolved === "dark" ? "dark" : "light"}"`);
    if (!themed.includes('class="waterfall"')) {
      themed = themed
        .replace(/<header><h1>([^<]*)<\/h1><p>([^<]*?) · ([^<]*)<\/p><\/header>/, `<header><h1>$1</h1><p><span class="status-pill" data-status="success">$3</span><span class="run-id" title="$2">$2</span></p></header>`)
        .replace(/<strong>(\d{4,})<\/strong>/g, (_, num) => `<strong>${Number(num).toLocaleString("en-US")}</strong>`)
        .replace(/<dd>(\d{4,})<\/dd>/g, (_, num) => `<dd>${Number(num).toLocaleString("en-US")}</dd>`)
        .replace(/padding-inline-start:(\d+)px/g, (_, px) => `padding-inline-start:${Math.round(Number(px) * 8 / 12)}px`)
        .replace(/<span class="metric">([^<]*)<small>(成功|success)<\/small><\/span>/gi, `<span class="metric">$1<small data-status="success">$2</small></span>`)
        .replace(/<p class="hint">([^<]*)<\/p><div class="axis"><span>0 s<\/span><span>([^<]*)<\/span><\/div>([\s\S]*?)<footer>/, (_, hint, endDur, details) => {
          const isZh = themed.includes('lang="zh"');
          return `<div class="legend-bar"><span class="legend-items"><span class="legend-dot run">${isZh ? "本轮执行" : "Run"}</span><span class="legend-dot model_call">${isZh ? "模型" : "Model"}</span><span class="legend-dot tool_call">${isZh ? "工具" : "Tool"}</span><span class="legend-dot subagent_task">${isZh ? "子 Agent" : "Subagent"}</span></span><p class="hint" title="${hint}">${isZh ? "点击步骤展开详情" : "Click a step for details"}</p></div><div class="waterfall"><div class="axis"><span>${isZh ? "执行步骤" : "Step"}</span><span class="axis-scale"><span>0 s</span><span>${endDur}</span></span><span class="axis-dur">${isZh ? "耗时" : "Duration"}</span></div>${details}</div><footer>`;
        });
    }
    const style = reportThemeStyle(family);
    return style ? themed.replace("</head>", `${style}</head>`) : themed;
  }
  $: themedHtml = injectReportTheme(html, appearance, themeFamily);
  function friendlyError(raw: string, chinese: boolean): string {
    if (!raw) return "";
    if (/trace not found|not recorded yet|ambiguous/i.test(raw)) return chinese ? "这一轮没有可用的调用链记录：可能早于 trace 记录功能、该轮未执行，或记录已被清理。" : "No call trace is available for this turn: it may predate trace recording, never executed, or the record was cleaned up.";
    if (/plugin is disabled/i.test(raw)) return chinese ? "调用链插件未启用。" : "The Call Trace plugin is disabled.";
    if (/request failed|failed to fetch|networkerror|load failed|\b5\d\d\b/i.test(raw)) return chinese ? "无法连接本机服务，请确认 Molibot 正在运行后重试。" : "Cannot reach the local service. Make sure Molibot is running and retry.";
    return raw;
  }
  function requestClose(): void {
    if (closing) return;
    closing = true;
    closeTimer = setTimeout(onClose, 200);
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") requestClose();
  }
  async function load(host: string, ids: string[], locale: string, theme: "auto" | "light" | "dark") {
    const current = ++generation;
    busy = true; error = "";
    try { const value = await loadTraceReportHtml(host, ids, locale, theme); if (current === generation) html = value; }
    catch (cause) { if (current === generation) error = String(cause instanceof Error ? cause.message : cause); }
    finally { if (current === generation) busy = false; }
  }
  async function publish() {
    busy = true; error = "";
    try { url = await publishTraceReport(endpoint, runIds, session.locale); }
    catch (cause) { error = String(cause instanceof Error ? cause.message : cause); }
    finally { busy = false; }
  }
</script>
<!-- The transcript lives inside `.workspace-main` (z-index 1), so a fixed
     overlay mounted there can never paint above the window header (z-index 31).
     Portal to the body like the other window-level overlays. -->
<Portal to="body">
  <div class="memory-trace-backdrop" class:closing role="presentation" onclick={(event) => event.target === event.currentTarget && requestClose()}>
    <div
      bind:this={panel}
      class="memory-trace-drawer trace-report-drawer"
      class:trace-report-fullscreen={fullscreen}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trace-report-title"
      tabindex="-1"
      onkeydown={onKeydown}
    >
      <header class="memory-trace-header trace-report-header">
        <div class="trace-report-header-title">
          <h2 id="trace-report-title">{zh ? "调用链" : "Call trace"}</h2>
        </div>
        <div class="trace-report-header-actions">
          <Button
            class="secondary-button trace-report-share-btn"
            disabled={busy}
            title={zh ? "分享公开链接（不含参数与结果摘要）" : "Share public link (excludes argument and result previews)"}
            onclick={publish}
          >
            <Share size={13} aria-hidden="true" />
            <span>{zh ? "分享公开链接" : "Share link"}</span>
          </Button>
          <button
            class="icon-button"
            type="button"
            disabled={busy}
            title={zh ? "刷新" : "Refresh"}
            aria-label={zh ? "刷新" : "Refresh"}
            onclick={() => load(endpoint, runIds, session.locale, appearance === "dark" ? "dark" : "light")}
          ><Refresh size={15} aria-hidden="true" /></button>
          <button
            class="icon-button"
            type="button"
            title={fullscreen ? (zh ? "退出全屏" : "Exit full screen") : (zh ? "全屏" : "Full screen")}
            aria-label={fullscreen ? (zh ? "退出全屏" : "Exit full screen") : (zh ? "全屏" : "Full screen")}
            onclick={() => (fullscreen = !fullscreen)}
          >{#if fullscreen}<ExitFullscreen size={16} aria-hidden="true" />{:else}<Expand size={16} aria-hidden="true" />{/if}</button>
          <button class="icon-button" type="button" title={zh ? "关闭" : "Close"} aria-label={zh ? "关闭" : "Close"} onclick={requestClose}><X size={16} aria-hidden="true" /></button>
        </div>
      </header>
      <div class="memory-trace-body trace-report-body">
        {#if errorText || url}
          <div class="trace-report-notices">
            {#if errorText}<p class="trace-report-error" role="alert">{errorText}</p>{/if}
            {#if url}<p class="trace-report-url"><span>{zh ? "公开链接：" : "Public link:"}</span><a href={url} target="_blank" rel="noreferrer">{url}</a></p>{/if}
          </div>
        {/if}
        {#if busy && !html}<div class="memory-trace-state" role="status"><Loader size={14} aria-hidden="true" />{zh ? "加载中…" : "Loading…"}</div>{/if}
        {#if html}<iframe title={zh ? "调用链报告" : "Call trace report"} sandbox="" style:color-scheme={appearance} srcdoc={themedHtml}></iframe>{/if}
      </div>
    </div>
    </div>
</Portal>
