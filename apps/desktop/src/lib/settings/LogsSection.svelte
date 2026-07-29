<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
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
        <button class="icon-button observatory-refresh-button" type="button" aria-label={session.text.refreshLogs} title={session.text.refreshLogs} disabled={refreshing} onclick={() => loadLogs(page)}><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button>
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
    <summary><span class="observatory-disclosure-label"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i>{session.text.logsMoreFilters}{#if advancedFilterCount}<em>{advancedFilterCount}</em>{/if}<i class="ph ph-caret-down observatory-disclosure-icon" aria-hidden="true"></i></span><span class="observatory-filter-updated">{session.text.logsTailWindow}</span></summary>
    <div class="observatory-filter-fields trace-advanced-filter-fields">
      <label class="observatory-field"><span>{session.text.logsEvent}</span><input bind:value={event} list="service-log-events" placeholder="llm_request_sent" /><datalist id="service-log-events">{#each options.events as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsRunId}</span><input bind:value={runId} placeholder={session.text.logsRunId} /></label>
      <label class="observatory-field"><span>{session.text.logsProvider}</span><input bind:value={provider} list="service-log-providers" placeholder={session.text.logsProvider} /><datalist id="service-log-providers">{#each options.providers as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsModel}</span><input bind:value={model} list="service-log-models" placeholder={session.text.logsModel} /><datalist id="service-log-models">{#each options.models as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsTool}</span><input bind:value={tool} list="service-log-tools" placeholder={session.text.logsTool} /><datalist id="service-log-tools">{#each options.tools as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.logsSubagent}</span><input bind:value={subagent} list="service-log-subagents" placeholder={session.text.logsSubagent} /><datalist id="service-log-subagents">{#each options.subagents as value}<option value={value}></option>{/each}</datalist></label>
    </div>
  </details>
</div>

{#if error}
  <div class="settings-card"><EmptyState title={error} icon="warning-circle" /></div>
{:else if loading}
  <div class="settings-card"><SkeletonRows count={6} label={session.text.loading} /></div>
{:else if !result || result.items.length === 0}
  <div class="settings-card"><EmptyState title={result?.total === 0 ? session.text.logsEmpty : session.text.logsNoMatches} icon="file-text" /></div>
{:else}
  {#if result.truncated}<div class="service-log-notice"><i class="ph ph-info" aria-hidden="true"></i>{session.text.logsTailTruncated}</div>{/if}
  <div class="settings-card observatory-data-card service-log-data-card">
    <div class="observatory-section-head"><div><strong>{session.text.logsRecords}</strong><p>{result.total} {session.text.logsMatches}{#if result.hasRawLines} · {session.text.logsRawCompatibility}{/if}</p></div><button class="tertiary-button" type="button" disabled={opening} onclick={openLogFile}>{session.text.openLogFile}</button></div>
    <div class="observatory-table-wrap"><table class="observatory-table service-log-table"><thead><tr><th>{session.text.logsTime}</th><th>{session.text.logsLevel}</th><th>{session.text.logsCategory}</th><th>{session.text.logsEvent}</th><th>{session.text.logsContext}</th><th>{session.text.logsStatus}</th><th>{session.text.logsRunId}</th><th>{session.text.logsDetails}</th></tr></thead><tbody>{#each result.items as log (log.id)}<tr><td>{log.ts ? formatNaturalDateTime(log.ts, session.locale) : "—"}</td><td><span class="service-log-level" data-level={log.level}>{log.level.toUpperCase()}</span></td><td>{humanizeTechnicalName(log.category)}</td><td><strong title={log.event}>{log.event}</strong>{#if log.message}<small title={log.message}>{log.message}</small>{/if}</td><td title={contextFor(log)}>{contextFor(log)}</td><td>{#if log.status}<StatusBadge label={humanizeTechnicalName(log.status)} state={statusState(log.status)} />{:else}—{/if}</td><td class="observatory-id" title={log.runId ?? ""}>{log.runId ?? "—"}</td><td><details class="service-log-raw"><summary>{session.text.logsRawLine}</summary><code>{log.raw}</code></details></td></tr>{/each}</tbody></table></div>
    <div class="observatory-mobile-list">{#each result.items as log (log.id)}<article><header><strong>{log.event}</strong><span class="service-log-level" data-level={log.level}>{log.level.toUpperCase()}</span></header><p>{log.ts ? formatNaturalDateTime(log.ts, session.locale) : "—"} · {humanizeTechnicalName(log.category)}</p><dl><div><dt>{session.text.logsStatus}</dt><dd>{log.status ?? "—"}</dd></div><div><dt>{session.text.logsContext}</dt><dd>{contextFor(log)}</dd></div><div><dt>{session.text.logsRunId}</dt><dd>{log.runId ?? "—"}</dd></div></dl><details class="service-log-raw"><summary>{session.text.logsRawLine}</summary><code>{log.raw}</code></details></article>{/each}</div>
    <div class="observatory-pagination"><span>{session.text.logsPage.replace("{page}", String(page)).replace("{pages}", String(totalPages)).replace("{total}", String(result.total))}</span><div><label>{session.text.logsPageSize}<SelectControl value={String(pageSize)} ariaLabel={session.text.logsPageSize} options={[25, 50, 100].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => { pageSize = Number(value); void loadLogs(1); }} /></label><button class="tertiary-button" type="button" disabled={page <= 1 || refreshing} onclick={previousLogsPage}>{session.text.logsPrevious}</button><button class="tertiary-button" type="button" disabled={page >= totalPages || refreshing} onclick={nextLogsPage}>{session.text.logsNext}</button></div></div>
  </div>
{/if}
