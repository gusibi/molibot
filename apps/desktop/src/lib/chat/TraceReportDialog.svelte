<script lang="ts">
  import { onMount } from "svelte";
  import Button from "../components/ui/Button.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import { loadTraceReportHtml, publishTraceReport } from "../api";
  import { session } from "../stores/session.svelte";
  export let endpoint: string;
  export let runIds: string[] = [];
  export let onClose: () => void;
  let html = "";
  let error = "";
  let url = "";
  let busy = false;
  let generation = 0;
  let appearance = "light";
  onMount(() => {
    const update = () => { appearance = document.documentElement.dataset.resolvedAppearance ?? "light"; };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-resolved-appearance"] });
    return () => { generation++; observer.disconnect(); };
  });
  $: zh = session.locale === "zh-CN";
  $: errorText = friendlyError(error, zh);
  $: if (runIds.length && endpoint) void load(endpoint, runIds, session.locale);
  function friendlyError(raw: string, chinese: boolean): string {
    if (!raw) return "";
    if (/trace not found|not recorded yet|ambiguous/i.test(raw)) return chinese ? "这一轮没有可用的调用链记录：可能早于 trace 记录功能、该轮未执行，或记录已被清理。" : "No call trace is available for this turn: it may predate trace recording, never executed, or the record was cleaned up.";
    if (/plugin is disabled/i.test(raw)) return chinese ? "调用链插件未启用。" : "The Call Trace plugin is disabled.";
    if (/request failed|failed to fetch|networkerror|load failed|\b5\d\d\b/i.test(raw)) return chinese ? "无法连接本机服务，请确认 Molibot 正在运行后重试。" : "Cannot reach the local service. Make sure Molibot is running and retry.";
    return raw;
  }
  async function load(host: string, ids: string[], locale: string) {
    const current = ++generation;
    busy = true; error = "";
    try { const value = await loadTraceReportHtml(host, ids, locale); if (current === generation) html = value; }
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
<Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }} overlayClass="markdown-artifact-overlay" contentClass="trace-report-dialog" labelledBy="trace-report-title">
  <header class="trace-report-toolbar">
    <h2 id="trace-report-title">{zh ? "调用链" : "Call trace"}</h2>
    <Button class="secondary-button" disabled={busy} onclick={() => load(endpoint, runIds, session.locale)}>{zh ? "刷新" : "Refresh"}</Button>
    <Button class="secondary-button" disabled={busy} onclick={publish}>{zh ? "分享公开链接（不含摘要）" : "Share public link (no previews)"}</Button>
    <Button class="secondary-button" onclick={onClose}>{zh ? "关闭" : "Close"}</Button>
  </header>
  {#if errorText}<p role="alert">{errorText}</p>{/if}
  {#if url}<p><a href={url} target="_blank" rel="noreferrer">{url}</a></p>{/if}
  {#if busy}<p role="status">{zh ? "加载中…" : "Loading…"}</p>{/if}
  {#if html}<iframe title={zh ? "调用链报告" : "Call trace report"} sandbox="" style:color-scheme={appearance} srcdoc={html}></iframe>{/if}
</Dialog>
