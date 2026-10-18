<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import Refresh from "reicon-svelte/icons/Refresh";
  import StopCircle from "reicon-svelte/icons/StopCircle";
  import Trash from "reicon-svelte/icons/Trash";
  import Tuning from "reicon-svelte/icons/Tuning";
  import { onMount, untrack } from "svelte";
  import type { DesktopActiveRunItem, DesktopTraceFact, DesktopTraceFactType, DesktopTraceRange, DesktopTraceStatus } from "@molibot/desktop-contract";
  import { formatDurationMs, formatLongDurationMs, formatTokenCount, loadDesktopActiveRuns, stopDesktopActiveRun } from "../api";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { formatNaturalDateTime, humanizeModelOption, humanizeTechnicalName } from "../presentation";
  import { session } from "../stores/session.svelte";
  import { tablist } from "../a11y/tablist";
  import { ActivityScheduler, documentActivityVisibility, interactiveActivityPolicy } from "../native/activityScheduler";
  import { TRACE_FACT_TYPES, TRACE_RANGES, loadTrace, resetTraceFilters, traceRangeLabel, traceStore, updateTraceQuery } from "../stores/trace.svelte";
  import Button from "../components/ui/Button.svelte";
  import AnalyticsRanking from "./AnalyticsRanking.svelte";
  import TraceTrend from "./TraceTrend.svelte";
  import AnalyticsComposition from "./AnalyticsComposition.svelte";
  import { cacheHitRate, compactCount, estimatedUsd, modelSuccessRate, percentage } from "./analytics";

  type RankingView = "tools" | "skills" | "models" | "bots" | "chats" | "sessions" | "runs";
  let rankingView = $state<RankingView>("tools");
  let factType = $state<DesktopTraceFactType>(traceStore.query.factType);
  let botId = $state(traceStore.query.botId);
  let channel = $state(traceStore.query.channel);
  let chatId = $state(traceStore.query.chatId);
  let sessionId = $state(traceStore.query.sessionId);
  let runId = $state(traceStore.query.runId);
  let agentId = $state(traceStore.query.agentId);
  let activeRuns = $state<DesktopActiveRunItem[]>([]);
  let activeRunsLoading = $state(false);
  let activeRunBusy = $state("");
  let activeRunMessage = $state("");
  let pendingActiveRun = $state<DesktopActiveRunItem | null>(null);
  let activeRunsGeneration = 0;
  let activeRunsScheduler: ActivityScheduler | null = null;

  async function refreshActiveRuns(): Promise<void> {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (!endpoint) { activeRuns = []; return; }
    const generation = ++activeRunsGeneration;
    activeRunsLoading = activeRuns.length === 0;
    try {
      const nextRuns = await loadDesktopActiveRuns(endpoint);
      if (generation !== activeRunsGeneration || endpoint !== session.endpoint || !session.serviceReady) return;
      activeRuns = nextRuns;
    } catch {
      if (generation !== activeRunsGeneration || endpoint !== session.endpoint) return;
      activeRuns = [];
    } finally {
      if (generation === activeRunsGeneration) activeRunsLoading = false;
    }
  }

  function requestActiveRunAction(item: DesktopActiveRunItem): void {
    if (activeRunBusy) return;
    pendingActiveRun = item;
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
    updateTraceQuery({ factType, botId: botId.trim(), channel: channel.trim(), chatId: chatId.trim(), sessionId: sessionId.trim(), runId: runId.trim(), agentId });
  }

  function clearFilters(): void {
    factType = "all";
    botId = "";
    channel = "";
    chatId = "";
    sessionId = "";
    runId = "";
    agentId = "";
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
    activeRunsScheduler = new ActivityScheduler(
      interactiveActivityPolicy,
      refreshActiveRuns,
      documentActivityVisibility
    );
    activeRunsScheduler.start();
    return () => {
      activeRunsGeneration += 1;
      activeRunsScheduler?.dispose();
      activeRunsScheduler = null;
    };
  });

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => {
      void loadTrace(endpoint);
      activeRunsScheduler?.wake("manual");
    });
  });

  const trace = $derived(traceStore.trace);
  const outcomes = $derived(trace?.totals.modelOutcomes);
  const successRate = $derived(outcomes ? modelSuccessRate(outcomes) : null);
  const outcomeItems = $derived(outcomes ? [
    { key: "success", label: session.text.traceSucceeded, value: outcomes.success, color: "var(--chart-green)" },
    { key: "error", label: session.text.traceFailed, value: outcomes.error, color: "var(--chart-red)" },
    { key: "pending", label: session.text.analyticsPending, value: outcomes.pending, color: "var(--chart-blue)" },
    { key: "aborted", label: session.text.analyticsCancelled, value: outcomes.aborted, color: "var(--label-secondary)" },
    { key: "blocked", label: session.text.traceBlocked, value: outcomes.blocked, color: "var(--chart-orange)" },
    { key: "other", label: session.text.analyticsOther, value: outcomes.other, color: "var(--label-tertiary)" }
  ] : []);
  const modelRows = $derived(trace?.rankings.models.map(row => ({ id: row.id, label: humanizeModelOption(`${row.provider}/${row.model}`, row.id).label, secondary: `${row.provider} · ${row.outcomes.success} ${session.text.traceSucceeded} · ${row.outcomes.error} ${session.text.traceFailed} · ${percentage(modelSuccessRate(row.outcomes))}`, value: row.requests })) ?? []);
  const botRows = $derived(trace?.rankings.bots.filter(row => row.modelCalls > 0).sort((a, b) => b.modelCalls - a.modelCalls).map(row => ({ id: row.id, label: row.label, secondary: `${row.outcomes.success} ${session.text.traceSucceeded} · ${row.outcomes.error} ${session.text.traceFailed}`, value: row.modelCalls })) ?? []);
  const channelRows = $derived(trace?.rankings.channels.filter(row => row.modelCalls > 0).map(row => ({ id: row.id, label: row.label, secondary: `${row.outcomes.success} ${session.text.traceSucceeded} · ${row.outcomes.error} ${session.text.traceFailed}`, value: row.modelCalls })) ?? []);
  const toolRows = $derived(trace?.rankings.tools.map(row => ({ id: row.name, label: humanizeTechnicalName(row.name), secondary: `${row.success} ${session.text.traceSucceeded} · ${row.error} ${session.text.traceFailed}`, value: row.calls })) ?? []);
  const skillRows = $derived(trace?.rankings.skills.map(row => ({ id: row.name, label: row.name, secondary: `${row.executed} ${session.text.traceExecuted}`, value: row.calls })) ?? []);
  const totalPages = $derived(trace ? Math.max(1, Math.ceil(trace.facts.total / trace.facts.pageSize)) : 1);
  const advancedFilterCount = $derived([botId, chatId, sessionId, runId].filter(value => value.trim()).length + (factType === "all" ? 0 : 1));
  const rankingTabs = $derived([
    { id: "tools" as const, label: session.text.traceRankTools },
    { id: "skills" as const, label: session.text.traceRankSkills },
    { id: "models" as const, label: session.text.traceRankModels },
    { id: "bots" as const, label: session.text.traceRankBots },
    { id: "chats" as const, label: session.text.traceRankChats },
    { id: "sessions" as const, label: session.text.traceRankSessions },
    { id: "runs" as const, label: session.text.traceRankRuns }
  ]);
  function selectModel(id: string): void { updateTraceQuery({ modelId: id.split("::").slice(0, 2).join("::") }); }
</script>

{#if traceStore.error}
  <div class="settings-card analytics-error" role="alert"><p>{traceStore.error}</p><Button onclick={() => session.endpoint && loadTrace(session.endpoint)}>{session.text.analyticsRetry}</Button></div>
{/if}
{#if !session.serviceReady}
  <div class="settings-card"><EmptyState title={session.text.traceUnavailable} icon="chart-line" /></div>
{:else if traceStore.loading}
  <div class="settings-card analytics-loading"><SkeletonRows count={7} label={session.text.loading} /></div>
{:else if trace && outcomes}
  <div class="analytics-dashboard" aria-busy={traceStore.refreshing}>
    <section class="settings-card analytics-overview" aria-label={session.text.analyticsAgentPerformance}>
      <dl class="analytics-summary">
        <div><dt>{session.text.analyticsRuns}</dt><dd>{compactCount(Object.values(trace.totals.runOutcomes).reduce((sum, value) => sum + value, 0))}</dd></div>
        <div><dt>{session.text.analyticsRunSuccess}</dt><dd title={session.text.analyticsRunSuccessHint}>{percentage(modelSuccessRate(trace.totals.runOutcomes))}</dd><small>{session.text.analyticsRunResults.replace("{success}", String(trace.totals.runOutcomes.success)).replace("{error}", String(trace.totals.runOutcomes.error))}</small></div>
        <div><dt>{session.text.analyticsEstimatedCost}</dt><dd title={session.text.analyticsCostHint}>{estimatedUsd(trace.totals.estimatedCostUsd)}</dd><small>{session.text.analyticsCostCoverage.replace("{known}", String(trace.totals.pricedModelCalls)).replace("{total}", String(trace.totals.modelCalls))}</small></div>
        <div><dt>{session.text.usageCacheHitRatio}</dt><dd>{percentage(cacheHitRate(trace.totals))}</dd></div>
      </dl>
    </section>
    <div class="settings-card analytics-filter-panel" role="group" aria-label={session.text.traceFilters}>
      <div class="analytics-toolbar-top"><div class="analytics-range-tabs" role="group" aria-label={session.text.traceRange}>{#each TRACE_RANGES as range}<Button class="analytics-range-button" aria-pressed={traceStore.query.range === range} onclick={() => updateTraceQuery({ range })}>{traceRangeLabel(range, session.text)}</Button>{/each}</div><div class="observatory-filter-actions"><Button onclick={clearFilters}>{session.text.traceResetFilters}</Button><Button variant="icon" title={session.text.traceRefresh} disabled={traceStore.refreshing} onclick={() => session.endpoint && loadTrace(session.endpoint)}><Refresh size={16} aria-hidden="true" /></Button></div></div>
      <div class="analytics-filters">
        <label class="analytics-filter"><span>{session.text.analyticsAgent}</span><SelectControl value={traceStore.query.agentId} ariaLabel={session.text.analyticsAgent} options={[{ value: "", label: session.text.analyticsAllAgents }, ...trace.options.agents.map(item => ({ value: item.id, label: item.id === "unknown" ? session.text.analyticsUnattributed : item.label }))]} onChange={value => { agentId = value; updateTraceQuery({ agentId: value }); }} /></label>
        <label class="analytics-filter"><span>{session.text.usageChannel}</span><SelectControl value={traceStore.query.channel} ariaLabel={session.text.usageChannel} options={[{ value: "", label: session.text.usageAllChannels }, ...trace.options.channels.map(value => ({ value, label: value }))]} onChange={value => { channel = value; updateTraceQuery({ channel: value }); }} /></label>
        <label class="analytics-filter"><span>{session.text.usageModel}</span><SelectControl value={traceStore.query.modelId} ariaLabel={session.text.usageModel} options={[{ value: "", label: session.text.usageAllModels }, ...trace.options.models]} onChange={modelId => updateTraceQuery({ modelId })} /></label>
      </div>
      <details class="observatory-advanced-filters"><summary><span class="observatory-disclosure-label"><Tuning size={16} aria-hidden="true" />{session.text.traceMoreFilters}{#if advancedFilterCount > 0}<em>{advancedFilterCount}</em>{/if}<AngleDown class="observatory-disclosure-icon" size={12} aria-hidden="true" /></span></summary>
        <div class="observatory-filter-fields trace-advanced-filter-fields">
          <label class="observatory-field"><span>{session.text.traceFactType}</span><SelectControl value={factType} ariaLabel={session.text.traceFactType} options={TRACE_FACT_TYPES.map(value => ({ value, label: factTypeLabel(value) }))} onChange={value => factType = value as DesktopTraceFactType} /></label>
          <label class="observatory-field"><span>{session.text.usageBot}</span><SelectControl value={botId} ariaLabel={session.text.usageBot} options={[{ value: "", label: session.text.usageAllBots }, ...trace.options.bots.map(value => ({ value, label: value }))]} onChange={value => botId = value} /></label>
          <label class="observatory-field"><span>{session.text.traceChatId}</span><input bind:value={chatId} /></label>
          <label class="observatory-field"><span>{session.text.traceSessionId}</span><input bind:value={sessionId} /></label>
          <label class="observatory-field"><span>{session.text.traceRunId}</span><input bind:value={runId} /></label>
          <Button disabled={traceStore.refreshing} onclick={applyFilters}>{session.text.traceApplyFilters}</Button>
        </div>
      </details>
    </div>
    <div class="analytics-status"><span>{trace.window.startDate} → {trace.window.endDate} · {trace.timezone}</span><span role="status">{traceStore.refreshing ? session.text.traceRefreshing : `${session.text.usageUpdatedAt} ${formatNaturalDateTime(trace.generatedAt, session.locale)}`}</span></div>
    <TraceTrend points={trace.trend} />
    <section class="settings-card analytics-ranking" aria-label={session.text.analyticsTraceAgents}>
      <header class="analytics-panel-head"><strong>{session.text.analyticsAgentPerformance}</strong></header>
      <div class="observatory-table-wrap"><table class="analytics-rank-table analytics-agent-table"><colgroup><col class="analytics-agent-name" /><col class="analytics-agent-runs" /><col class="analytics-agent-rate" /><col class="analytics-agent-cost" /><col class="analytics-agent-cache" /></colgroup><thead><tr><th scope="col">{session.text.analyticsAgent}</th><th scope="col">{session.text.analyticsRuns}</th><th scope="col" title={session.text.analyticsRunSuccessHint}>{session.text.analyticsRunSuccessShort}</th><th scope="col" title={session.text.analyticsCostHint}>{session.text.analyticsCostShort}</th><th scope="col">{session.text.analyticsCacheShort}</th></tr></thead><tbody>
        {#each trace.rankings.agents as row (row.id)}<tr><td><button class="analytics-rank-button" type="button" onclick={() => { agentId = row.id; updateTraceQuery({ agentId }); }}><strong>{row.id === "unknown" ? session.text.analyticsUnattributed : row.label}</strong></button><small class="analytics-rank-secondary">{compactCount(row.modelCalls)} {session.text.traceModelCalls}</small></td><td>{Object.values(row.runOutcomes).reduce((sum, value) => sum + value, 0)}</td><td title={session.text.analyticsRunResults.replace("{success}", String(row.runOutcomes.success)).replace("{error}", String(row.runOutcomes.error))}>{percentage(modelSuccessRate(row.runOutcomes))}</td><td>{estimatedUsd(row.estimatedCostUsd)}<small class="analytics-rank-secondary" title={session.text.analyticsCostCoverage.replace("{known}", String(row.pricedModelCalls)).replace("{total}", String(row.modelCalls))}>{row.pricedModelCalls}/{row.modelCalls} {session.text.analyticsCostRecordedShort}</small></td><td>{percentage(cacheHitRate(row))}</td></tr>{/each}
      </tbody></table></div>
      {#if trace.rankings.agents.length === 0}<EmptyState title={session.text.analyticsNoData} icon="chart-line" />{/if}
      <details class="analytics-details"><summary>{session.text.analyticsMetricDefinitions}</summary><p class="analytics-caption">{session.text.analyticsRunSuccessHint}</p><p class="analytics-caption">{session.text.analyticsCostHint}</p></details>
    </section>
    <section class="settings-card analytics-overview" aria-label={session.text.analyticsModelResults}>
      <dl class="analytics-summary"><div><dt>{traceRangeLabel(trace.range, session.text)} · {session.text.traceModelCalls}</dt><dd title={formatTokenCount(trace.totals.modelCalls)}>{compactCount(trace.totals.modelCalls)}</dd></div><div><dt>{session.text.traceSucceeded}</dt><dd title={formatTokenCount(outcomes.success)}>{compactCount(outcomes.success)}</dd></div><div><dt>{session.text.traceFailed}</dt><dd title={formatTokenCount(outcomes.error)}>{compactCount(outcomes.error)}</dd></div><div><dt>{session.text.analyticsSuccessRate}</dt><dd title={session.text.analyticsCompletedHint}>{percentage(successRate)}</dd></div></dl>
    </section>
    <section class="settings-card analytics-chart-panel" aria-label={session.text.analyticsResultDistribution}>
      <header class="analytics-panel-head"><strong>{session.text.analyticsResultDistribution}</strong><span>{session.text.traceAverage} {formatDurationMs(trace.totals.avgModelDurationMs)}</span></header>
      <AnalyticsComposition title={session.text.analyticsModelResults} items={outcomeItems} unit={session.text.traceRequests} />
      <p class="analytics-caption">{session.text.analyticsResultsHint} {session.text.analyticsCompletedHint}</p>
    </section>
    <AnalyticsRanking title={session.text.analyticsModelRanking} rows={modelRows} total={trace.totals.modelCalls} unit={session.text.traceRequests} onselect={selectModel} />
    <AnalyticsRanking title={session.text.analyticsTraceBots} rows={botRows} total={trace.totals.modelCalls} unit={session.text.traceRequests} onselect={value => { botId = value; updateTraceQuery({ botId: value }); }} />
    <AnalyticsRanking title={session.text.analyticsTraceChannels} rows={channelRows} total={trace.totals.modelCalls} unit={session.text.traceRequests} onselect={value => { channel = value; updateTraceQuery({ channel: value }); }} />
    {#if toolRows.length > 0 || skillRows.length > 0}<div class="analytics-ranking-grid"><AnalyticsRanking title={session.text.traceRankTools} rows={toolRows} total={trace.totals.toolCalls} unit={session.text.traceCalls} /><AnalyticsRanking title={session.text.traceRankSkills} rows={skillRows} total={trace.totals.skillUsages} unit={session.text.traceCalls} /></div>{/if}
    <p class="analytics-caption analytics-window-note">{session.text.analyticsFullWindow}</p>
    <details class="analytics-details"><summary>{session.text.analyticsDiagnostics}</summary><div class="analytics-detail-content">
  <div class="settings-card observatory-data-card" id="trace-ranking-panel" role="tabpanel" aria-labelledby={`trace-ranking-tab-${rankingView}`}>
    <div class="observatory-section-head"><div><strong>{session.text.traceRankings}</strong></div><div class="observatory-tabs" role="tablist" aria-label={session.text.traceRankings} use:tablist>{#each rankingTabs as tab (tab.id)}<button type="button" role="tab" id={`trace-ranking-tab-${tab.id}`} aria-selected={rankingView === tab.id} aria-controls="trace-ranking-panel" class:active={rankingView === tab.id} onclick={() => rankingView = tab.id}>{tab.label}</button>{/each}</div></div>
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
  </div>    </div></details>
  </div>
{/if}

<p class="settings-group-title">{session.text.traceActiveRuns}</p>
<div class="settings-card trace-active-runs">
  {#if activeRunsLoading}<SkeletonRows count={3} label={session.text.loading} />
  {:else if activeRuns.length === 0}<EmptyState title={session.text.traceNoActiveRuns} description={session.text.traceNoActiveRunsHint} icon="activity" />
  {:else}{#each activeRuns as item (item.runId)}<div class="settings-row trace-active-run-row"><div class="profile-info"><div class="trace-active-run-title"><strong>{item.agentName} · {item.botName}</strong><StatusBadge label={item.status === "running" ? session.text.traceRunRunning : item.status === "stuck" ? session.text.traceRunStuck : session.text.traceRunOrphan} state={item.status === "running" ? "ready" : item.status === "stuck" ? "warning" : "disconnected"} /></div><p>{item.channel} · {formatLongDurationMs(item.durationMs, session.locale)} · {formatNaturalDateTime(item.startedAt, session.locale)}</p><details class="trace-run-technical technical-detail"><summary>{session.text.technicalDetails}</summary><dl><div><dt>{session.text.traceTask}</dt><dd>{item.taskPreview || session.text.traceTaskUnavailable}</dd></div><div><dt>{session.text.traceRunId}</dt><dd><code>{item.runId}</code></dd></div></dl></details></div><OverflowMenu label={session.text.more}><button role="menuitem" class="danger-action" type="button" disabled={Boolean(activeRunBusy)} onclick={() => void requestActiveRunAction(item)}>{#if item.status === "orphan"}<Trash size={14} aria-hidden="true" />{:else}<StopCircle size={14} aria-hidden="true" />{/if}{item.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun}</button></OverflowMenu></div>{/each}{/if}
</div>
{#if activeRunMessage}<p class="settings-section-hint" aria-live="polite">{activeRunMessage}</p>{/if}
{#if pendingActiveRun}<AlertDialog open={Boolean(pendingActiveRun)} busy={Boolean(activeRunBusy)} contentClass="task-delete-confirm-modal" labelledBy="trace-confirm-title" describedBy="trace-confirm-description" onOpenChange={(next) => { if (!next) cancelActiveRunAction(); }}><header class="modal-head"><div><strong id="trace-confirm-title">{pendingActiveRun.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun}</strong><p id="trace-confirm-description">{pendingActiveRun.status === "orphan" ? session.text.traceClearOrphanConfirm : session.text.traceStopRunConfirm}</p></div></header><footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(activeRunBusy)} onclick={cancelActiveRunAction}>{session.text.cancel}</button><button class="primary-button danger-action" type="button" disabled={Boolean(activeRunBusy)} onclick={() => void stopActiveRun()}>{pendingActiveRun.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun}</button></footer></AlertDialog>{/if}
