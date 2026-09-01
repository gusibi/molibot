<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import Check from "reicon-svelte/icons/Check";
  import Copy from "reicon-svelte/icons/Copy";
  import InfoCircle from "reicon-svelte/icons/InfoCircle";
  import Refresh from "reicon-svelte/icons/Refresh";
  import Tuning from "reicon-svelte/icons/Tuning";
  import X from "reicon-svelte/icons/X";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SearchField from "../components/ui/SearchField.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { formatNaturalDateTime, humanizeTechnicalName } from "../presentation";
  import { session } from "../stores/session.svelte";

  interface ServiceLogQuery {
    levels: string[];
    categories: string[];
    statuses: string[];
    event?: string;
    keyword?: string;
    runId?: string;
    provider?: string;
    model?: string;
    tool?: string;
    subagent?: string;
    page: number;
    pageSize: number;
  }

  interface ServiceLogRecord {
    id: string;
    ts?: string;
    level: string;
    category: string;
    event: string;
    status?: string;
    message?: string;
    raw: string;
    runId?: string;
    sessionId?: string;
    provider?: string;
    model?: string;
    tool?: string;
    toolCallId?: string;
    subagent?: string;
    delegationId?: string;
    durationMs?: number;
  }

  interface ServiceLogOptions {
    levels: string[];
    categories: string[];
    statuses: string[];
    events: string[];
    providers: string[];
    models: string[];
    tools: string[];
    subagents: string[];
  }

  interface ServiceLogPage {
    items: ServiceLogRecord[];
    total: number;
    page: number;
    pageSize: number;
    scannedLines: number;
    truncated: boolean;
    hasRawLines: boolean;
    options: ServiceLogOptions;
  }

  const emptyOptions: ServiceLogOptions = { levels: [], categories: [], statuses: [], events: [], providers: [], models: [], tools: [], subagents: [] };
  let result = $state<ServiceLogPage | null>(null);
  let loading = $state(false);
  let refreshing = $state(false);
  let opening = $state(false);
  let error = $state("");
  let keyword = $state("");
  let level = $state("all");
  let category = $state("all");
  let status = $state("all");
  let event = $state("");
  let runId = $state("");
  let provider = $state("");
  let model = $state("");
  let tool = $state("");
  let subagent = $state("");
  let page = $state(1);
  let pageSize = $state(50);
  let selectedLog = $state<ServiceLogRecord | null>(null);
  let detailCopied = $state(false);

  function buildQuery(targetPage = page): ServiceLogQuery {
    return {
      levels: level === "all" ? [] : [level],
      categories: category === "all" ? [] : [category],
      statuses: status === "all" ? [] : [status],
      event: event.trim() || undefined,
      keyword: keyword.trim() || undefined,
      runId: runId.trim() || undefined,
      provider: provider.trim() || undefined,
      model: model.trim() || undefined,
      tool: tool.trim() || undefined,
      subagent: subagent.trim() || undefined,
      page: targetPage,
      pageSize
    };
  }

  async function loadLogs(targetPage = page): Promise<void> {
    const firstLoad = !result;
    if (firstLoad) loading = true; else refreshing = true;
    error = "";
    try {
      const query = buildQuery(targetPage);
      const nextResult = await invoke<ServiceLogPage>("desktop_logs", { query });
      result = nextResult;
      page = nextResult.page;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function applyFilters(): void { void loadLogs(1); }

  function clearFilters(): void {
    keyword = ""; level = "all"; category = "all"; status = "all"; event = "";
    runId = ""; provider = ""; model = ""; tool = ""; subagent = ""; page = 1;
    void loadLogs(1);
  }

  function previousLogsPage(): void { if (page > 1) void loadLogs(page - 1); }
  function nextLogsPage(): void { if (page < totalPages) void loadLogs(page + 1); }

  async function openLogFile(): Promise<void> {
    opening = true;
    try { await invoke("open_desktop_log"); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { opening = false; }
  }

  function statusState(value: string): "ready" | "warning" | "error" | "disconnected" {
    if (value === "success") return "ready";
    if (value === "error") return "error";
    if (["blocked", "timeout", "retrying"].includes(value)) return "warning";
    return "disconnected";
  }

  function contextFor(log: ServiceLogRecord): string {
    return [log.provider, log.model, log.tool, log.subagent].filter(Boolean).join(" · ") || "—";
  }

  function compactRunId(value?: string): string {
    if (!value) return "—";
    if (value.length <= 28) return value;
    return `${value.slice(0, 13)}…${value.slice(-12)}`;
  }

  function structuredLogJson(log: ServiceLogRecord): string | null {
    const source = log.raw.startsWith("[mom-t] ") ? log.raw.slice(8).trim() : log.raw.trim();
    if (!source.startsWith("{")) return null;
    try {
      const parsed: unknown = JSON.parse(source);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  }

  function detailText(log: ServiceLogRecord): string {
    return structuredLogJson(log) ?? log.raw;
  }

  function openLogDetail(log: ServiceLogRecord): void {
    selectedLog = log;
    detailCopied = false;
  }

  function closeLogDetail(): void {
    selectedLog = null;
    detailCopied = false;
  }

  function handleRowKeydown(event: KeyboardEvent, log: ServiceLogRecord): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openLogDetail(log);
  }

  async function copyLogDetail(): Promise<void> {
    if (!selectedLog) return;
    await navigator.clipboard.writeText(detailText(selectedLog));
    detailCopied = true;
  }

  const options = $derived(result?.options ?? emptyOptions);
  const totalPages = $derived(Math.max(1, Math.ceil((result?.total ?? 0) / pageSize)));
  const advancedFilterCount = $derived([event, runId, provider, model, tool, subagent].filter((value) => value.trim()).length);

  onMount(() => { void loadLogs(1); });
</script>

<div class="settings-card observatory-filter-card">
  <div class="observatory-filter-toolbar" role="group" aria-label={session.text.logsFilters}>
    <div class="observatory-filter-headline">
      <div class="observatory-filter-title"><strong>{session.text.logsFilters}</strong><p>{result ? `${result.scannedLines} ${session.text.logsScanned}` : session.text.logsStructuredHint}</p></div>
      <div class="observatory-filter-actions">
        <button class="tertiary-button observatory-reset-button" type="button" onclick={clearFilters}>{session.text.logsClearFilters}</button>
        <button class="icon-button observatory-refresh-button" type="button" aria-label={session.text.refreshLogs} title={session.text.refreshLogs} disabled={refreshing} onclick={() => loadLogs(page)}><Refresh size={16} aria-hidden="true" /></button>
        <button class="primary-button" type="button" disabled={refreshing} onclick={applyFilters}>{refreshing ? session.text.loading : session.text.logsApplyFilters}</button>
      </div>
    </div>
    <div class="observatory-filter-fields service-log-filter-fields">
      <label class="observatory-field"><span>{session.text.logsSearch}</span><SearchField value={keyword} label={session.text.logsSearch} placeholder={session.text.logsSearchPlaceholder} onInput={(value) => keyword = value} /></label>
      <label class="observatory-field"><span>{session.text.logsLevel}</span><SelectControl value={level} ariaLabel={session.text.logsLevel} options={[{ value: "all", label: session.text.logsAll }, ...options.levels.map((value) => ({ value, label: value.toUpperCase() }))]} onChange={(value) => level = value} /></label>
      <label class="observatory-field"><span>{session.text.logsCategory}</span><SelectControl value={category} ariaLabel={session.text.logsCategory} options={[{ value: "all", label: session.text.logsAll }, ...options.categories.map((value) => ({ value, label: humanizeTechnicalName(value) }))]} onChange={(value) => category = value} /></label>
      <label class="observatory-field"><span>{session.text.logsStatus}</span><SelectControl value={status} ariaLabel={session.text.logsStatus} options={[{ value: "all", label: session.text.logsAll }, ...options.statuses.map((value) => ({ value, label: humanizeTechnicalName(value) }))]} onChange={(value) => status = value} /></label>
    </div>
  </div>
  <details class="observatory-advanced-filters">
    <summary><span class="observatory-disclosure-label"><Tuning size={16} aria-hidden="true" />{session.text.logsMoreFilters}{#if advancedFilterCount}<em>{advancedFilterCount}</em>{/if}<AngleDown class="observatory-disclosure-icon" size={12} aria-hidden="true" /></span><span class="observatory-filter-updated">{session.text.logsTailWindow}</span></summary>
    <div class="observatory-filter-fields trace-advanced-filter-fields">
      <label class="observatory-field"><span>{session.text.logsEvent}</span><input bind:value={event} autocomplete="off" spellcheck="false" list="service-log-events" placeholder="llm_request_sent" /><datalist id="service-log-events">{#each options.events as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsRunId}</span><input bind:value={runId} autocomplete="off" spellcheck="false" placeholder={session.text.logsRunId} /></label>
      <label class="observatory-field"><span>{session.text.logsProvider}</span><input bind:value={provider} autocomplete="off" spellcheck="false" list="service-log-providers" placeholder={session.text.logsProvider} /><datalist id="service-log-providers">{#each options.providers as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsModel}</span><input bind:value={model} autocomplete="off" spellcheck="false" list="service-log-models" placeholder={session.text.logsModel} /><datalist id="service-log-models">{#each options.models as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsTool}</span><input bind:value={tool} autocomplete="off" spellcheck="false" list="service-log-tools" placeholder={session.text.logsTool} /><datalist id="service-log-tools">{#each options.tools as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsSubagent}</span><input bind:value={subagent} autocomplete="off" spellcheck="false" list="service-log-subagents" placeholder={session.text.logsSubagent} /><datalist id="service-log-subagents">{#each options.subagents as value}<option value={value}></option>{/each}</datalist></label>
    </div>
  </details>
</div>

{#if error}
  <div class="settings-card" aria-live="polite"><EmptyState title={error} icon="warning-circle" /></div>
{:else if loading}
  <div class="settings-card"><SkeletonRows count={6} label={session.text.loading} /></div>
{:else if !result || result.items.length === 0}
  <div class="settings-card"><EmptyState title={result?.total === 0 ? session.text.logsEmpty : session.text.logsNoMatches} icon="file-text" /></div>
{:else}
  {#if result.truncated}<div class="service-log-notice"><InfoCircle size={16} aria-hidden="true" />{session.text.logsTailTruncated}</div>{/if}
  <div class="settings-card observatory-data-card service-log-data-card">
    <div class="observatory-section-head"><div><strong>{session.text.logsRecords}</strong><p>{result.total} {session.text.logsMatches}{#if result.hasRawLines} · {session.text.logsRawCompatibility}{/if}</p></div><button class="tertiary-button" type="button" disabled={opening} onclick={openLogFile}>{session.text.openLogFile}</button></div>
    <div class="observatory-table-wrap"><table class="observatory-table service-log-table"><thead><tr><th>{session.text.logsTime}</th><th>{session.text.logsLevel}</th><th>{session.text.logsCategory}</th><th>{session.text.logsEvent}</th><th>{session.text.logsStatus}</th><th>{session.text.logsRunId}</th><th>{session.text.logsDetails}</th></tr></thead><tbody>{#each result.items as log (log.id)}<tr class="service-log-row" role="button" tabindex="0" aria-label={`${session.text.logsViewDetails}: ${log.event}`} onclick={() => openLogDetail(log)} onkeydown={(rowEvent) => handleRowKeydown(rowEvent, log)}><td>{log.ts ? formatNaturalDateTime(log.ts, session.locale) : "—"}</td><td><span class="service-log-level" data-level={log.level}>{log.level.toUpperCase()}</span></td><td>{humanizeTechnicalName(log.category)}</td><td><strong title={log.event}>{log.event}</strong><small title={log.message ?? contextFor(log)}>{log.message ?? contextFor(log)}</small></td><td>{#if log.status}<StatusBadge label={humanizeTechnicalName(log.status)} state={statusState(log.status)} />{:else}—{/if}</td><td class="observatory-id" title={log.runId ?? ""}><code class="service-log-run-id">{compactRunId(log.runId)}</code></td><td><span class="service-log-detail-button">{session.text.logsViewDetails}</span></td></tr>{/each}</tbody></table></div>
    <div class="observatory-mobile-list">{#each result.items as log (log.id)}<div class="service-log-mobile-row" role="button" tabindex="0" aria-label={`${session.text.logsViewDetails}: ${log.event}`} onclick={() => openLogDetail(log)} onkeydown={(rowEvent) => handleRowKeydown(rowEvent, log)}><header><strong>{log.event}</strong><span class="service-log-level" data-level={log.level}>{log.level.toUpperCase()}</span></header><p>{log.ts ? formatNaturalDateTime(log.ts, session.locale) : "—"} · {humanizeTechnicalName(log.category)}</p><dl><div><dt>{session.text.logsStatus}</dt><dd>{log.status ?? "—"}</dd></div><div><dt>{session.text.logsContext}</dt><dd>{contextFor(log)}</dd></div><div><dt>{session.text.logsRunId}</dt><dd title={log.runId ?? ""}>{compactRunId(log.runId)}</dd></div></dl><span class="service-log-detail-button">{session.text.logsViewDetails}</span></div>{/each}</div>
    <div class="observatory-pagination"><span>{session.text.logsPage.replace("{page}", String(page)).replace("{pages}", String(totalPages)).replace("{total}", String(result.total))}</span><div><label>{session.text.logsPageSize}<SelectControl value={String(pageSize)} ariaLabel={session.text.logsPageSize} options={[25, 50, 100].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => { pageSize = Number(value); void loadLogs(1); }} /></label><button class="tertiary-button" type="button" disabled={page <= 1 || refreshing} onclick={previousLogsPage}>{session.text.logsPrevious}</button><button class="tertiary-button" type="button" disabled={page >= totalPages || refreshing} onclick={nextLogsPage}>{session.text.logsNext}</button></div></div>
  </div>
{/if}

<Dialog open={Boolean(selectedLog)} contentClass="service-log-detail-dialog" labelledBy="service-log-detail-title" describedBy="service-log-detail-description" onOpenChange={(next) => { if (!next) closeLogDetail(); }}>
  {#if selectedLog}
    <header class="service-log-detail-head">
      <div>
        <span class="service-log-level" data-level={selectedLog.level}>{selectedLog.level.toUpperCase()}</span>
        <h2 id="service-log-detail-title">{session.text.logsDetailTitle}</h2>
        <p id="service-log-detail-description">{selectedLog.event} · {selectedLog.ts ? formatNaturalDateTime(selectedLog.ts, session.locale) : session.text.logsRawLine}</p>
      </div>
      <button class="modal-close" type="button" aria-label={session.text.logsClose} onclick={closeLogDetail}><X size={16} aria-hidden="true" /></button>
    </header>
    <div class="service-log-detail-body">
      <dl class="service-log-detail-metadata">
        <div><dt>{session.text.logsRunId}</dt><dd><code>{selectedLog.runId ?? "—"}</code></dd></div>
        <div><dt>{session.text.logsSessionId}</dt><dd><code>{selectedLog.sessionId ?? "—"}</code></dd></div>
        <div><dt>{session.text.logsContext}</dt><dd>{contextFor(selectedLog)}</dd></div>
        <div><dt>{session.text.logsStatus}</dt><dd>{selectedLog.status ? humanizeTechnicalName(selectedLog.status) : "—"}</dd></div>
        {#if selectedLog.toolCallId}<div><dt>{session.text.logsToolCallId}</dt><dd><code>{selectedLog.toolCallId}</code></dd></div>{/if}
        {#if selectedLog.delegationId}<div><dt>{session.text.logsDelegationId}</dt><dd><code>{selectedLog.delegationId}</code></dd></div>{/if}
      </dl>
      <section class="service-log-detail-payload">
        <div><strong>{structuredLogJson(selectedLog) ? session.text.logsStructuredJson : session.text.logsRawText}</strong><span>{structuredLogJson(selectedLog) ? "JSON" : "TEXT"}</span></div>
        <pre><code>{detailText(selectedLog)}</code></pre>
      </section>
    </div>
    <footer class="service-log-detail-foot">
      <button class="tertiary-button" type="button" onclick={copyLogDetail}>{#if detailCopied}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}{detailCopied ? session.text.logsCopied : session.text.logsCopyContent}</button>
      <button class="primary-button" type="button" onclick={closeLogDetail}>{session.text.logsClose}</button>
    </footer>
  {/if}
</Dialog>
