<script lang="ts">
  import { onMount } from "svelte";
  import Button from "../components/ui/Button.svelte";
  import Loader from "reicon-svelte/icons/Loader";
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
    "--card-bg", "--surface-secondary", "--label-primary", "--label-secondary", "--separator",
    "--accent", "--online", "--skill-accent", "--font-ui", "--font-mono",
    "--fs-body", "--fs-label", "--fs-meta", "--fs-page", "--radius-small", "--radius-control",
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
    return `<style data-theme-family="${family}">:root{${declarations}}main>header h1{display:none}main>header p{margin:0 0 8px}</style>`;
  }
  function injectReportTheme(source: string, resolved: string, family: string): string {
    if (!source) return source;
    const themed = source.replace(/data-theme="[^"]*"/, `data-theme="${resolved === "dark" ? "dark" : "light"}"`);
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
      <div class="trace-report-toolbar">
        <Button class="secondary-button" disabled={busy} onclick={() => load(endpoint, runIds, session.locale, appearance === "dark" ? "dark" : "light")}>{zh ? "刷新" : "Refresh"}</Button>
        <Button class="secondary-button" disabled={busy} onclick={publish}>{zh ? "分享公开链接（不含摘要）" : "Share public link (no previews)"}</Button>
      </div>
      {#if errorText}<p class="trace-report-error" role="alert">{errorText}</p>{/if}
      {#if url}<p class="trace-report-url"><a href={url} target="_blank" rel="noreferrer">{url}</a></p>{/if}
      {#if busy && !html}<div class="memory-trace-state" role="status"><Loader size={14} aria-hidden="true" />{zh ? "加载中…" : "Loading…"}</div>{/if}
      {#if html}<iframe title={zh ? "调用链报告" : "Call trace report"} sandbox="" style:color-scheme={appearance} srcdoc={themedHtml}></iframe>{/if}
    </div>
  </div>
</div>
