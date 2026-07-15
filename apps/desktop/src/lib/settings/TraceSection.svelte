<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import type { DesktopActiveRunItem, DesktopTraceFact, DesktopTraceFactType, DesktopTraceRange, DesktopTraceStatus } from "@molibot/desktop-contract";
  import { formatDurationMs, formatLongDurationMs, formatTokenCount, loadDesktopActiveRuns, stopDesktopActiveRun } from "../api";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { formatNaturalDateTime, humanizeModelOption, humanizeTechnicalName } from "../presentation";
  import { session } from "../stores/session.svelte";
  import { TRACE_FACT_TYPES, TRACE_RANGES, loadTrace, resetTraceFilters, traceRangeLabel, traceStore, updateTraceQuery } from "../stores/trace.svelte";
  import { DONUT_R, donutSegments, percentOf } from "./charts";

  type RankingView = "tools" | "skills" | "models" | "bots" | "chats" | "sessions" | "runs";
  let rankingView = $state<RankingView>("tools");
  let factType = $state<DesktopTraceFactType>(traceStore.query.factType);
  let botId = $state(traceStore.query.botId);
  let channel = $state(traceStore.query.channel);
  let chatId = $state(traceStore.query.chatId);
  let sessionId = $state(traceStore.query.sessionId);
  let runId = $state(traceStore.query.runId);
  let sourceLimit = $state(String(traceStore.query.sourceLimit));
  let activeRuns = $state<DesktopActiveRunItem[]>([]);
  let activeRunsLoading = $state(false);
  let activeRunBusy = $state("");
  let activeRunMessage = $state("");
  let pendingActiveRun = $state<DesktopActiveRunItem | null>(null);
  let activeRunDialog = $state<HTMLDivElement>();

  async function refreshActiveRuns(): Promise<void> {
    if (!session.serviceReady || !session.endpoint) { activeRuns = []; return; }
    activeRunsLoading = activeRuns.length === 0;
    try { activeRuns = await loadDesktopActiveRuns(session.endpoint); }
    catch { activeRuns = []; }
    finally { activeRunsLoading = false; }
  }

  async function requestActiveRunAction(item: DesktopActiveRunItem): Promise<void> {
    if (activeRunBusy) return;
    pendingActiveRun = item;
    await tick();
    activeRunDialog?.focus();
  }

  function cancelActiveRunAction(): void {
    if (!activeRunBusy) pendingActiveRun = null;
  }

  async function stopActiveRun(): Promise<void> {
    if (!session.endpoint || activeRunBusy || !pendingActiveRun) return;
    const selected = pendingActiveRun;
    pendingActiveRun = null;
    activeRunBusy = selected.runId;
    activeRunMessage = "";
    try {
      const result = await stopDesktopActiveRun(session.endpoint, selected.runId);
      activeRunMessage = result === "stopped" ? session.text.traceRunStopped : session.text.traceOrphanCleared;
      await Promise.all([refreshActiveRuns(), loadTrace(session.endpoint)]);
    } catch (cause) { activeRunMessage = cause instanceof Error ? cause.message : String(cause); }
    finally { activeRunBusy = ""; }
  }

  function applyFilters(): void {
    updateTraceQuery({ factType, botId: botId.trim(), channel: channel.trim(), chatId: chatId.trim(), sessionId: sessionId.trim(), runId: runId.trim(), sourceLimit: Number(sourceLimit) });
  }

  function clearFilters(): void {
    factType = "all";
    botId = "";
    channel = "";
    chatId = "";
    sessionId = "";
    runId = "";
    sourceLimit = "5000";
    resetTraceFilters();
  }

  function shortId(value: string): string {
    return value.length <= 20 ? value : `${value.slice(0, 9)}…${value.slice(-7)}`;
  }

  function factTypeLabel(value: DesktopTraceFactType): string {
    if (value === "all") return session.text.traceAllFactTypes;
    if (value === "run") return session.text.traceFact_run;
    if (value === "tool_call") return session.text.traceFact_tool_call;
    if (value === "model_call") return session.text.traceFact_model_call;
    if (value === "skill_usage") return session.text.traceFact_skill_usage;
    if (value === "subagent_task") return session.text.traceFact_subagent_task;
    if (value === "runtime_notice") return session.text.traceFact_runtime_notice;
    if (value === "approval") return session.text.traceFact_approval;
    return session.text.traceFact_input_enrichment;
  }

  function statusLabel(value: DesktopTraceStatus): string {
    if (value === "started") return session.text.traceStatus_started;
    if (value === "success") return session.text.traceStatus_success;
    if (value === "error") return session.text.traceStatus_error;
    if (value === "blocked") return session.text.traceStatus_blocked;
    if (value === "waiting") return session.text.traceStatus_waiting;
    if (value === "aborted") return session.text.traceStatus_aborted;
    if (value === "warning") return session.text.traceStatus_warning;
    return session.text.traceStatus_info;
  }

  function statusState(value: DesktopTraceStatus): "ready" | "warning" | "error" | "disconnected" {
    if (value === "success") return "ready";
    if (value === "error") return "error";
    if (value === "blocked" || value === "aborted" || value === "warning") return "warning";
    return "disconnected";
  }

  function factName(fact: DesktopTraceFact): string {
    if (fact.factType === "model_call") return humanizeModelOption(`${fact.provider}/${fact.model}`, `${fact.provider}::${fact.model}`).label;
    if (fact.name) return humanizeTechnicalName(fact.name);
    return factTypeLabel(fact.factType);
  }

  onMount(() => {
    const timer = setInterval(() => void refreshActiveRuns(), 3000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => {
      if (endpoint !== traceStore.endpoint) void loadTrace(endpoint);
      void refreshActiveRuns();
    });
  });

  const trace = $derived(traceStore.trace);
  const activityItems = $derived(trace ? [
    { key: "tools", label: session.text.traceToolCalls, value: trace.totals.toolCalls, color: "var(--chart-blue)" },
    { key: "models", label: session.text.traceModelCalls, value: trace.totals.modelCalls, color: "var(--chart-purple)" },
    { key: "skills", label: session.text.traceSkills, value: trace.totals.skillUsages, color: "var(--chart-teal)" },
    { key: "runs", label: session.text.traceRuns, value: trace.totals.runs, color: "var(--chart-indigo)" }
  ] : []);
  const activityMax = $derived(Math.max(1, ...activityItems.map((item) => item.value)));
  const outcomeItems = $derived(trace ? [
    { key: "ok", label: session.text.traceSucceeded, value: Math.max(0, trace.totals.executedToolCalls - trace.totals.failedTools), color: "var(--chart-green)" },
    { key: "failed", label: session.text.traceFailed, value: trace.totals.failedTools, color: "var(--chart-red)" },
    { key: "blocked", label: session.text.traceBlocked, value: trace.totals.blockedTools, color: "var(--chart-orange)" }
  ] : []);
  const outcomeTotal = $derived(outcomeItems.reduce((sum, item) => sum + item.value, 0));
  const outcomeSegments = $derived(donutSegments(outcomeItems));
  const durationMax = $derived(trace ? Math.max(1, trace.totals.avgToolDurationMs, trace.totals.avgModelDurationMs) : 1);
  const totalPages = $derived(trace ? Math.max(1, Math.ceil(trace.facts.total / trace.facts.pageSize)) : 1);
  const rankingTabs = $derived([
    { id: "tools" as const, label: session.text.traceRankTools },
    { id: "skills" as const, label: session.text.traceRankSkills },
    { id: "models" as const, label: session.text.traceRankModels },
    { id: "bots" as const, label: session.text.traceRankBots },
    { id: "chats" as const, label: session.text.traceRankChats },
    { id: "sessions" as const, label: session.text.traceRankSessions },
    { id: "runs" as const, label: session.text.traceRankRuns }
  ]);
</script>

{#if !session.serviceReady}
  <div class="settings-card"><EmptyState title={session.text.traceUnavailable} icon="pulse" /></div>
{:else if traceStore.loading}
  <div class="settings-card"><SkeletonRows count={5} label={session.text.loading} /></div>
{:else if !trace}
  <div class="settings-card"><EmptyState title={session.text.traceEmpty} icon="chart-line" /></div>
{:else}
  <div class="settings-card observatory-filter-card">
    <div class="observatory-filter-head">
      <div><strong>{session.text.traceFilters}</strong><p>{trace.window.startDate} → {trace.window.endDate} · {trace.timezone}</p></div>
      <div class="observatory-filter-actions"><button class="secondary-button" type="button" onclick={clearFilters}>{session.text.traceResetFilters}</button><button class="primary-button" type="button" disabled={traceStore.refreshing} onclick={applyFilters}>{traceStore.refreshing ? session.text.traceRefreshing : session.text.traceApplyFilters}</button></div>
    </div>
    <div class="observatory-filter-grid trace-filter-grid">
      <label class="observatory-field"><span>{session.text.traceRange}</span><SelectControl value={traceStore.query.range} ariaLabel={session.text.traceRange} options={TRACE_RANGES.map((range) => ({ value: range, label: traceRangeLabel(range, session.text) }))} onChange={(value) => updateTraceQuery({ range: value as DesktopTraceRange })} /></label>
      <label class="observatory-field"><span>{session.text.traceFactType}</span><SelectControl value={factType} ariaLabel={session.text.traceFactType} options={TRACE_FACT_TYPES.map((value) => ({ value, label: factTypeLabel(value) }))} onChange={(value) => factType = value as DesktopTraceFactType} /></label>
      <label class="observatory-field"><span>{session.text.usageBot}</span><input bind:value={botId} list="trace-bots" placeholder={session.text.usageAllBots} /><datalist id="trace-bots">{#each trace.options.bots as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.usageChannel}</span><input bind:value={channel} list="trace-channels" placeholder={session.text.usageAllChannels} /><datalist id="trace-channels">{#each trace.options.channels as value}<option value={value}></option>{/each}</datalist></label>
      <label class="observatory-field"><span>{session.text.traceChatId}</span><input bind:value={chatId} placeholder={session.text.traceChatId} /></label>
      <label class="observatory-field"><span>{session.text.traceSessionId}</span><input bind:value={sessionId} placeholder={session.text.traceSessionId} /></label>
      <label class="observatory-field"><span>{session.text.traceRunId}</span><input bind:value={runId} placeholder={session.text.traceRunId} /></label>
      <label class="observatory-field"><span>{session.text.traceSourceLimit}</span><SelectControl value={sourceLimit} ariaLabel={session.text.traceSourceLimit} options={[1000, 5000, 10000].map((value) => ({ value: String(value), label: formatTokenCount(value) }))} onChange={(value) => sourceLimit = value} /></label>
    </div>
    <div class="observatory-filter-foot"><span>{session.text.usageUpdatedAt} {formatNaturalDateTime(trace.generatedAt, session.locale)}</span><button class="secondary-button" type="button" disabled={traceStore.refreshing} onclick={() => session.endpoint && loadTrace(session.endpoint)}>{traceStore.refreshing ? session.text.traceRefreshing : session.text.traceRefresh}</button></div>
  </div>

  <div class="chart-kpi-grid">
    <div class="chart-kpi" style="--kpi-accent:var(--chart-indigo)"><span class="chart-kpi-label">{session.text.traceFacts}</span><strong class="chart-kpi-value">{formatTokenCount(trace.totals.facts)}</strong><span class="chart-kpi-foot">{formatTokenCount(trace.totals.runs)} {session.text.traceRuns}</span></div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-blue)"><span class="chart-kpi-label">{session.text.traceToolCalls}</span><strong class="chart-kpi-value">{formatTokenCount(trace.totals.toolCalls)}</strong><span class="chart-kpi-foot">{session.text.traceFailed} {trace.totals.failedTools} · {session.text.traceBlocked} {trace.totals.blockedTools}</span></div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-purple)"><span class="chart-kpi-label">{session.text.traceModelCalls}</span><strong class="chart-kpi-value">{formatTokenCount(trace.totals.modelCalls)}</strong><span class="chart-kpi-foot">{formatTokenCount(trace.totals.totalTokens)} {session.text.usageTokens}</span></div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-teal)"><span class="chart-kpi-label">{session.text.traceSkills}</span><strong class="chart-kpi-value">{formatTokenCount(trace.totals.skillUsages)}</strong><span class="chart-kpi-foot">{formatTokenCount(trace.totals.distinctSkills)} {session.text.traceDistinct}</span></div>
  </div>

  <div class="settings-card chart-card"><div class="chart-card-head"><div><strong>{session.text.traceActivity}</strong></div></div><div class="hbar-list">{#each activityItems as item (item.key)}<div class="hbar-row"><span class="hbar-label">{item.label}</span><div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(item.value, activityMax))}%;background:{item.color}"></span></div><span class="hbar-value">{formatTokenCount(item.value)}</span></div>{/each}</div></div>

  <div class="chart-split">
    <div class="settings-card chart-card"><div class="chart-card-head"><div><strong>{session.text.traceToolOutcome}</strong></div></div><div class="donut-block"><div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 42 42" role="img" aria-label={session.text.traceToolOutcome}><circle class="donut-track" cx="21" cy="21" r={DONUT_R} />{#each outcomeSegments as segment (segment.key)}<circle class="donut-seg" cx="21" cy="21" r={DONUT_R} stroke={segment.color} stroke-dasharray="{segment.len} {100 - segment.len}" stroke-dashoffset={segment.offset} />{/each}</svg><div class="donut-center"><strong>{formatTokenCount(trace.totals.toolCalls)}</strong><small>{session.text.traceToolCalls}</small></div></div><ul class="chart-legend">{#each outcomeItems as item (item.key)}<li><span class="legend-dot" style="background:{item.color}"></span><span class="legend-name">{item.label}</span><span class="legend-value">{formatTokenCount(item.value)}<em>{percentOf(item.value, outcomeTotal)}%</em></span></li>{/each}</ul></div></div>
    <div class="settings-card chart-card"><div class="chart-card-head"><div><strong>{session.text.traceDurationCompare}</strong></div></div><div class="hbar-list"><div class="hbar-row"><span class="hbar-label">{session.text.traceTool}</span><div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(trace.totals.avgToolDurationMs, durationMax))}%;background:var(--chart-blue)"></span></div><span class="hbar-value">{formatDurationMs(trace.totals.avgToolDurationMs)}</span></div><div class="hbar-row"><span class="hbar-label">{session.text.traceModel}</span><div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(trace.totals.avgModelDurationMs, durationMax))}%;background:var(--chart-purple)"></span></div><span class="hbar-value">{formatDurationMs(trace.totals.avgModelDurationMs)}</span></div></div></div>
  </div>

  <div class="settings-card observatory-data-card">
    <div class="observatory-section-head"><div><strong>{session.text.traceRankings}</strong></div><div class="observatory-tabs" role="tablist">{#each rankingTabs as tab (tab.id)}<button type="button" role="tab" aria-selected={rankingView === tab.id} class:active={rankingView === tab.id} onclick={() => rankingView = tab.id}>{tab.label}</button>{/each}</div></div>
    {#if trace.rankings[rankingView].length === 0}<EmptyState title={session.text.traceNoRankings} icon="ranking" />{:else}
      <div class="observatory-table-wrap ranking-table-wrap"><table class="observatory-table"><thead>
        {#if rankingView === "tools"}<tr><th>{session.text.traceRankTools}</th><th>{session.text.traceCalls}</th><th>{session.text.traceExecuted}</th><th>{session.text.traceSuccess}</th><th>{session.text.traceErrors}</th><th>{session.text.traceBlocked}</th><th>{session.text.traceAverage}</th></tr>
        {:else if rankingView === "skills"}<tr><th>{session.text.traceRankSkills}</th><th>{session.text.traceScope}</th><th>{session.text.traceCalls}</th><th>{session.text.traceTriggered}</th><th>{session.text.traceLoaded}</th><th>{session.text.traceExecuted}</th><th>{session.text.traceRuns}</th><th>{session.text.traceAverage}</th></tr>
        {:else if rankingView === "models"}<tr><th>{session.text.traceRankModels}</th><th>{session.text.usageProvider}</th><th>{session.text.usageRankApi}</th><th>{session.text.traceRequests}</th><th>{session.text.usageInput}</th><th>{session.text.usageOutput}</th><th>{session.text.traceTokens}</th><th>{session.text.traceAverage}</th></tr>
        {:else}<tr><th>{rankingTabs.find((tab) => tab.id === rankingView)?.label}</th><th>{session.text.traceRuns}</th><th>{session.text.traceToolCalls}</th><th>{session.text.traceModelCalls}</th><th>{session.text.traceDistinct}</th><th>{session.text.traceTokens}</th><th>{session.text.traceLastUpdate}</th></tr>{/if}
      </thead><tbody>
        {#if rankingView === "tools"}{#each trace.rankings.tools as row (row.name)}<tr><td><strong>{humanizeTechnicalName(row.name)}</strong><small class="observatory-id">{row.name}</small></td><td>{row.calls}</td><td>{row.executedCalls}</td><td>{row.success}</td><td>{row.error}</td><td>{row.blocked}</td><td>{formatDurationMs(row.avgDurationMs)}</td></tr>{/each}
        {:else if rankingView === "skills"}{#each trace.rankings.skills as row (row.name)}<tr><td><strong>{humanizeTechnicalName(row.name)}</strong><small class="observatory-id">{row.name}</small></td><td>{row.scope}</td><td>{row.calls}</td><td>{row.triggered}</td><td>{row.loaded}</td><td>{row.executed}</td><td>{row.runs}</td><td>{formatDurationMs(row.avgDurationMs)}</td></tr>{/each}
        {:else if rankingView === "models"}{#each trace.rankings.models as row (row.id)}<tr><td><strong>{humanizeModelOption(`${row.provider}/${row.model}`, row.id).label}</strong></td><td>{row.provider}</td><td>{row.api}</td><td>{row.requests}</td><td>{formatTokenCount(row.inputTokens)}</td><td>{formatTokenCount(row.outputTokens)}</td><td>{formatTokenCount(row.totalTokens)}</td><td>{formatDurationMs(row.avgDurationMs)}</td></tr>{/each}
        {:else}{#each trace.rankings[rankingView] as row (row.id)}<tr><td title={row.id}><strong>{shortId(row.label)}</strong>{#if row.secondary}<small>{row.secondary}</small>{/if}</td><td>{row.runs}</td><td>{row.toolCalls}</td><td>{row.modelCalls}</td><td>{row.distinctTools}</td><td>{formatTokenCount(row.totalTokens)}</td><td>{formatNaturalDateTime(row.lastAt, session.locale)}</td></tr>{/each}{/if}
      </tbody></table></div>
    {/if}
  </div>

  <div class="settings-card observatory-data-card">
    <div class="observatory-section-head"><div><strong>{session.text.traceRecentFacts}</strong><p>{session.text.traceRecentFactsHint}</p></div></div>
    {#if trace.facts.items.length === 0}<EmptyState title={session.text.traceNoFacts} icon="list-magnifying-glass" />{:else}
      <div class="observatory-table-wrap"><table class="observatory-table"><thead><tr><th>{session.text.usageTime}</th><th>{session.text.traceType}</th><th>{session.text.traceName}</th><th>{session.text.traceStatus}</th><th>{session.text.usageChannel}</th><th>{session.text.usageBot}</th><th>{session.text.traceRunId}</th><th>{session.text.traceSessionId}</th><th>{session.text.traceDurations}</th><th>{session.text.traceTokens}</th></tr></thead><tbody>{#each trace.facts.items as fact (fact.id)}<tr><td>{formatNaturalDateTime(fact.updatedAt, session.locale)}</td><td>{factTypeLabel(fact.factType)}</td><td><strong>{factName(fact)}</strong>{#if fact.api}<small>{fact.provider} · {fact.api}</small>{/if}</td><td><StatusBadge label={statusLabel(fact.status)} state={statusState(fact.status)} /></td><td>{fact.channel}</td><td class="observatory-id" title={fact.botId}>{shortId(fact.botId)}</td><td class="observatory-id" title={fact.runId}>{shortId(fact.runId)}</td><td class="observatory-id" title={fact.sessionId}>{shortId(fact.sessionId)}</td><td>{fact.durationMs ? formatDurationMs(fact.durationMs) : "—"}</td><td>{fact.totalTokens ? formatTokenCount(fact.totalTokens) : "—"}</td></tr>{/each}</tbody></table></div>
      <div class="observatory-mobile-list">{#each trace.facts.items as fact (fact.id)}<article><header><strong>{factName(fact)}</strong><StatusBadge label={statusLabel(fact.status)} state={statusState(fact.status)} /></header><p>{formatNaturalDateTime(fact.updatedAt, session.locale)} · {factTypeLabel(fact.factType)} · {fact.channel}</p><dl><div><dt>{session.text.usageBot}</dt><dd title={fact.botId}>{shortId(fact.botId)}</dd></div><div><dt>{session.text.traceRunId}</dt><dd title={fact.runId}>{shortId(fact.runId)}</dd></div><div><dt>{session.text.traceDurations}</dt><dd>{fact.durationMs ? formatDurationMs(fact.durationMs) : "—"}</dd></div><div><dt>{session.text.traceTokens}</dt><dd>{fact.totalTokens ? formatTokenCount(fact.totalTokens) : "—"}</dd></div></dl></article>{/each}</div>
    {/if}
    <div class="observatory-pagination"><span>{session.text.tracePage.replace("{page}", String(trace.facts.page)).replace("{pages}", String(totalPages)).replace("{total}", String(trace.facts.total))}</span><div><label>{session.text.usagePageSize}<SelectControl value={String(traceStore.query.pageSize)} ariaLabel={session.text.usagePageSize} options={[10, 20, 50, 100].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => updateTraceQuery({ pageSize: Number(value) })} /></label><button class="secondary-button" type="button" disabled={trace.facts.page <= 1 || traceStore.refreshing} onclick={() => updateTraceQuery({ page: trace.facts.page - 1 }, false)}>{session.text.usagePrevious}</button><button class="secondary-button" type="button" disabled={trace.facts.page >= totalPages || traceStore.refreshing} onclick={() => updateTraceQuery({ page: trace.facts.page + 1 }, false)}>{session.text.usageNext}</button></div></div>
  </div>
{/if}

<p class="settings-group-title">{session.text.traceActiveRuns}</p>
<div class="settings-card trace-active-runs">
  {#if activeRunsLoading}<SkeletonRows count={3} label={session.text.loading} />
  {:else if activeRuns.length === 0}<EmptyState title={session.text.traceNoActiveRuns} description={session.text.traceNoActiveRunsHint} icon="activity" />
  {:else}{#each activeRuns as item (item.runId)}<div class="settings-row trace-active-run-row"><div class="profile-info"><div class="trace-active-run-title"><strong>{item.agentName} · {item.botName}</strong><StatusBadge label={item.status === "running" ? session.text.traceRunRunning : item.status === "stuck" ? session.text.traceRunStuck : session.text.traceRunOrphan} state={item.status === "running" ? "ready" : item.status === "stuck" ? "warning" : "disconnected"} /></div><p>{item.channel} · {formatLongDurationMs(item.durationMs, session.locale)} · {formatNaturalDateTime(item.startedAt, session.locale)}</p><details class="trace-run-technical technical-detail"><summary>{session.text.technicalDetails}</summary><dl><div><dt>{session.text.traceTask}</dt><dd>{item.taskPreview || session.text.traceTaskUnavailable}</dd></div><div><dt>{session.text.traceRunId}</dt><dd><code>{item.runId}</code></dd></div></dl></details></div><OverflowMenu label={session.text.more}><button role="menuitem" class="danger-action" type="button" disabled={Boolean(activeRunBusy)} onclick={() => void requestActiveRunAction(item)}><i class="ph ph-{item.status === "orphan" ? "trash" : "stop-circle"}" aria-hidden="true"></i>{item.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun}</button></OverflowMenu></div>{/each}{/if}
</div>
{#if activeRunMessage}<p class="settings-section-hint">{activeRunMessage}</p>{/if}
{#if pendingActiveRun}<div bind:this={activeRunDialog} class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={pendingActiveRun.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun} onclick={cancelActiveRunAction} onkeydown={(event) => { if (event.key === "Escape") cancelActiveRunAction(); }}><div class="modal-card task-delete-confirm-modal" role="presentation" onclick={(event) => event.stopPropagation()}><header class="modal-head"><div><strong>{pendingActiveRun.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun}</strong><p>{pendingActiveRun.status === "orphan" ? session.text.traceClearOrphanConfirm : session.text.traceStopRunConfirm}</p></div></header><footer class="entity-editor-foot"><button class="secondary-button" type="button" onclick={cancelActiveRunAction}>{session.text.cancel}</button><button class="primary-button danger-action" type="button" onclick={() => void stopActiveRun()}>{pendingActiveRun.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun}</button></footer></div></div>{/if}
