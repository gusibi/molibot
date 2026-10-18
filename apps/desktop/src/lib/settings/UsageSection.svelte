<script lang="ts">
  import Refresh from "reicon-svelte/icons/Refresh";
  import { untrack } from "svelte";
  import type { DesktopUsageRange } from "@molibot/desktop-contract";
  import { formatTokenCount } from "../api";
  import Button from "../components/ui/Button.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { formatNaturalDateTime, humanizeModelOption } from "../presentation";
  import { session } from "../stores/session.svelte";
  import { tablist } from "../a11y/tablist";
  import { USAGE_RANGES, loadUsage, resetUsageFilters, updateUsageQuery, usageStore, usageWindowLabel } from "../stores/usage.svelte";
  import { trendLinePath } from "./charts";
  import { cacheHitRate, compactCount, percentage } from "./analytics";
  import AnalyticsRanking from "./AnalyticsRanking.svelte";
  import AnalyticsComposition from "./AnalyticsComposition.svelte";

  type RankingView = "apis" | "sessions";
  let rankingView = $state<RankingView>("apis");
  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => { void loadUsage(endpoint); });
  });
  const usage = $derived(usageStore.usage);
  const trend = $derived(usage?.trend ?? []);
  const tokenMax = $derived(Math.max(1, ...trend.map(point => point.totalTokens)));
  const tokenLine = $derived(trendLinePath(trend.map(point => point.totalTokens), tokenMax));
  const totalPages = $derived(usage ? Math.max(1, Math.ceil(usage.records.total / usage.records.pageSize)) : 1);
  const cacheHit = $derived(usage ? cacheHitRate(usage.totals) : null);
  const distribution = $derived(usage ? [
    { key: "input", label: session.text.analyticsUncachedInput, value: usage.totals.inputTokens, color: "var(--chart-blue)" },
    { key: "cacheRead", label: session.text.usageCacheRead, value: usage.totals.cacheReadTokens, color: "var(--chart-teal)" },
    { key: "cacheWrite", label: session.text.usageCacheWrite, value: usage.totals.cacheWriteTokens, color: "var(--chart-orange)" },
    { key: "output", label: session.text.usageOutput, value: usage.totals.outputTokens, color: "var(--label-secondary)" },
    { key: "unknown", label: session.text.analyticsUnknownTokens, value: Math.max(0, usage.totals.totalTokens - usage.totals.inputTokens - usage.totals.outputTokens - usage.totals.cacheReadTokens - usage.totals.cacheWriteTokens), color: "var(--label-tertiary)" }
  ].filter(item => item.key !== "unknown" || item.value > 0) : []);
  const modelRows = $derived(usage?.rankings.models.map(row => ({ id: row.id, label: humanizeModelOption(`${row.provider}/${row.model}`, row.id).label, secondary: `${row.provider} · ${compactCount(row.requests)} ${session.text.usageRequests}`, value: row.totalTokens })) ?? []);
  const botRows = $derived(usage?.rankings.bots.map(row => ({ id: row.id, label: row.label, secondary: `${compactCount(row.requests)} ${session.text.usageRequests}`, value: row.totalTokens })) ?? []);
  const channelRows = $derived(usage?.rankings.channels.map(row => ({ id: row.id, label: row.label, secondary: `${compactCount(row.requests)} ${session.text.usageRequests}`, value: row.totalTokens })) ?? []);
  const agentRows = $derived(usage?.rankings.agents.map(row => ({ id: row.id, label: row.id === "unknown" ? session.text.analyticsUnattributed : row.label, secondary: `${compactCount(row.requests)} ${session.text.usageRequests}`, value: row.totalTokens })) ?? []);
  const rankingTabs = $derived([
    { id: "apis" as const, label: session.text.usageRankApi },
    { id: "sessions" as const, label: session.text.usageRankSession }
  ]);
  const otherRows = $derived(usage?.rankings[rankingView].map(row => ({ id: row.id, label: row.label, secondary: `${compactCount(row.requests)} ${session.text.usageRequests}`, value: row.totalTokens })) ?? []);
  function formatDate(value: string): string { return formatNaturalDateTime(value, session.locale); }
</script>

{#if usageStore.error}
  <div class="settings-card analytics-error" role="alert"><p>{usageStore.error}</p><Button onclick={() => session.endpoint && loadUsage(session.endpoint)}>{session.text.analyticsRetry}</Button></div>
{/if}
{#if !session.serviceReady}
  <div class="settings-card"><EmptyState title={session.text.usageUnavailable} icon="chart-line" /></div>
{:else if usageStore.loading}
  <div class="settings-card analytics-loading"><SkeletonRows count={7} label={session.text.loading} /></div>
{:else if usage}
  <div class="analytics-dashboard" aria-busy={usageStore.refreshing}>
    <section class="settings-card analytics-overview" aria-label={session.text.analyticsOverview}>
      <dl class="analytics-summary">
        <div><dt>{usageWindowLabel(usage.range, session.text)} · {session.text.usageTokens}</dt><dd title={formatTokenCount(usage.totals.totalTokens)}>{compactCount(usage.totals.totalTokens)}</dd></div>
        <div><dt>{session.text.usageRequests}</dt><dd title={formatTokenCount(usage.totals.requests)}>{compactCount(usage.totals.requests)}</dd></div>
        <div><dt>{session.text.usageCacheRead}</dt><dd title={formatTokenCount(usage.totals.cacheReadTokens)}>{compactCount(usage.totals.cacheReadTokens)}</dd></div>
        <div><dt>{session.text.usageCacheHitRatio}</dt><dd title={session.text.analyticsCacheHint}>{percentage(cacheHit)}</dd></div>
      </dl>
    </section>
    <div class="settings-card analytics-filter-panel" role="group" aria-label={session.text.usageFilters}>
      <div class="analytics-toolbar-top">
        <div class="analytics-range-tabs" role="group" aria-label={session.text.traceRange}>{#each USAGE_RANGES as range}<Button class="analytics-range-button" aria-pressed={usageStore.query.range === range} onclick={() => updateUsageQuery({ range })}>{usageWindowLabel(range, session.text)}</Button>{/each}</div>
        <div class="observatory-filter-actions"><Button onclick={resetUsageFilters}>{session.text.usageClearFilters}</Button><Button variant="icon" title={session.text.usageRefresh} disabled={usageStore.refreshing} onclick={() => session.endpoint && loadUsage(session.endpoint)}><Refresh size={16} aria-hidden="true" /></Button></div>
      </div>
      <div class="analytics-filters">
        <label class="analytics-filter"><span>{session.text.usageModel}</span><SelectControl value={usageStore.query.modelId} ariaLabel={session.text.usageModel} options={[{ value: "all", label: session.text.usageAllModels }, ...usage.options.models.map(item => ({ value: item.id, label: humanizeModelOption(item.label, item.id).label }))]} onChange={modelId => updateUsageQuery({ modelId })} /></label>
        <label class="analytics-filter"><span>{session.text.analyticsAgent}</span><SelectControl value={usageStore.query.agentId} ariaLabel={session.text.analyticsAgent} options={[{ value: "all", label: session.text.analyticsAllAgents }, ...usage.options.agents.map(item => ({ value: item.id, label: item.id === "unknown" ? session.text.analyticsUnattributed : item.label }))]} onChange={agentId => updateUsageQuery({ agentId })} /></label>
        <label class="analytics-filter"><span>{session.text.usageChannel}</span><SelectControl value={usageStore.query.channel} ariaLabel={session.text.usageChannel} options={[{ value: "all", label: session.text.usageAllChannels }, ...usage.options.channels.map(channel => ({ value: channel, label: channel }))]} onChange={channel => updateUsageQuery({ channel })} /></label>
      </div>
    </div>
    <div class="analytics-status"><span>{usage.window.startDate} → {usage.window.endDate} · {usage.timezone}</span><span role="status">{usageStore.refreshing ? session.text.traceRefreshing : `${session.text.usageUpdatedAt} ${formatDate(usage.generatedAt)}`}</span></div>
    <section class="settings-card analytics-trend" aria-label={session.text.analyticsTrend}>
      <header class="analytics-panel-head"><strong>{session.text.analyticsTrend}</strong><span>{usageWindowLabel(usage.range, session.text)}</span></header>
      <div class="analytics-trend-plot"><div class="analytics-trend-scale" aria-hidden="true"><span>{usage.totals.totalTokens > 0 ? compactCount(tokenMax) : "0"}</span><span>{usage.totals.totalTokens > 0 ? compactCount(tokenMax / 2) : "0"}</span><span>0</span></div><div class="trend-wrap"><svg class="trend-svg" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label={session.text.analyticsTrend}><title>{trend.map(point => `${point.label}: ${formatTokenCount(point.totalTokens)}`).join('; ')}</title>{#each [5, 22.5, 40] as y}<line class="trend-grid" x1="0" y1={y} x2="100" y2={y} vector-effect="non-scaling-stroke" />{/each}<path class="analytics-trend-line" d={tokenLine} vector-effect="non-scaling-stroke" /></svg><div class="trend-axis">{#each trend.filter((_, i) => i === 0 || i === Math.floor(trend.length / 2) || i === trend.length - 1) as point}<span>{point.label}</span>{/each}</div></div></div>
    </section>
    <section class="settings-card analytics-chart-panel" aria-label={session.text.analyticsCache}>
      <header class="analytics-panel-head"><strong>{session.text.analyticsCache}</strong><span>{session.text.usageCacheHitRatio} {percentage(cacheHit)}</span></header>
      <AnalyticsComposition title={session.text.analyticsCache} items={distribution} />
      <p class="analytics-caption">{cacheHit === null ? session.text.analyticsNoCache : session.text.analyticsCacheHint}</p>
    </section>
    <AnalyticsRanking title={session.text.analyticsModels} rows={modelRows} unit={session.text.usageTokens} total={usage.totals.totalTokens} onselect={id => updateUsageQuery({ modelId: id.split("::").slice(0, 2).join("::") })} />
    <div class="analytics-ranking-grid">
      <AnalyticsRanking title={session.text.analyticsAgents} rows={agentRows} unit={session.text.usageTokens} total={usage.totals.totalTokens} onselect={agentId => updateUsageQuery({ agentId })} />
      <AnalyticsRanking title={session.text.analyticsBots} rows={botRows} unit={session.text.usageTokens} total={usage.totals.totalTokens} onselect={botId => updateUsageQuery({ botId })} />
    </div>
    <AnalyticsRanking title={session.text.analyticsChannels} rows={channelRows} unit={session.text.usageTokens} total={usage.totals.totalTokens} onselect={channel => updateUsageQuery({ channel })} />
    {#if usage.totals.imageCostKnownRequests || usage.totals.imageCostUnknownRequests}
      <div class="settings-card settings-row"><span>{session.text.mediaTaskEstimatedCost}</span><strong>{usage.totals.imageEstimatedCostUsd === undefined ? session.text.mediaTaskCostUnknown : `$${usage.totals.imageEstimatedCostUsd.toFixed(6)}`}{#if usage.totals.imageCostUnknownRequests} · {session.text.mediaTaskCostUnknown}: {usage.totals.imageCostUnknownRequests}{/if}</strong></div>
    {/if}
    <details class="analytics-details"><summary>{session.text.analyticsRequestDetails}</summary>
      <div class="analytics-detail-content">
        <section class="settings-card analytics-ranking" aria-label={session.text.usageWindowCompare}>
          <header class="analytics-panel-head"><strong>{session.text.usageWindowCompare}</strong></header>
          <dl class="analytics-composition-legend">{#each usage.windows as window}<div><dt>{usageWindowLabel(window.label, session.text)}</dt><dd title={formatTokenCount(window.totalTokens)}>{compactCount(window.totalTokens)}<small>{compactCount(window.requests)} {session.text.usageRequests}</small></dd></div>{/each}</dl>
        </section>
        <div class="analytics-detail-tabs" role="tablist" aria-label={session.text.usageRankings} use:tablist>{#each rankingTabs as tab}<button role="tab" type="button" id={`usage-dimension-${tab.id}`} aria-controls="usage-dimension-panel" aria-selected={rankingView === tab.id} class:active={rankingView === tab.id} onclick={() => rankingView = tab.id}>{tab.label}</button>{/each}</div>
        <div id="usage-dimension-panel" role="tabpanel" aria-labelledby={`usage-dimension-${rankingView}`}><AnalyticsRanking title={session.text.usageRankings} rows={otherRows} unit={session.text.usageTokens} total={usage.totals.totalTokens} /></div>
  <div class="settings-card observatory-data-card">
    <div class="observatory-section-head"><div><strong>{session.text.usageRecentRequests}</strong><p>{session.text.usageRecentRequestsHint}</p></div></div>
    {#if usage.records.items.length === 0}<EmptyState title={session.text.usageNoRecords} icon="list-magnifying-glass" />{:else}
      <div class="observatory-table-wrap"><table class="observatory-table"><thead><tr><th>{session.text.usageTime}</th><th>{session.text.usageModel}</th><th>{session.text.usageChannel}</th><th>{session.text.analyticsAgent}</th><th>{session.text.usageBot}</th><th>{session.text.usageRankApi}</th><th>{session.text.usageInput}</th><th>{session.text.usageOutput}</th><th>{session.text.usageCache}</th><th>{session.text.usageTotalTokens}</th></tr></thead><tbody>{#each usage.records.items as record (record.requestId ?? record.ts + record.botId + record.model)}<tr><td>{formatDate(record.ts)}</td><td><strong>{humanizeModelOption(`${record.provider}/${record.model}`, `${record.provider}::${record.model}`).label}</strong><small>{record.provider}</small></td><td>{record.channel}</td><td>{usage.options.agents.find(agent => agent.id === record.agentId)?.label ?? session.text.analyticsUnattributed}</td><td class="observatory-id">{record.botId}</td><td class="observatory-id">{record.api}</td><td>{formatTokenCount(record.inputTokens)}</td><td>{formatTokenCount(record.outputTokens)}</td><td>{formatTokenCount(record.cacheReadTokens + record.cacheWriteTokens)}</td><td><strong>{formatTokenCount(record.totalTokens)}</strong></td></tr>{/each}</tbody></table></div>
      <div class="observatory-mobile-list">{#each usage.records.items as record (record.requestId ?? record.ts + record.botId + record.model)}<article><header><strong>{humanizeModelOption(`${record.provider}/${record.model}`, `${record.provider}::${record.model}`).label}</strong><span>{formatTokenCount(record.totalTokens)} {session.text.usageTokens}</span></header><p>{formatDate(record.ts)} · {record.channel} · {record.botId}</p><dl><div><dt>{session.text.usageInput}</dt><dd>{formatTokenCount(record.inputTokens)}</dd></div><div><dt>{session.text.usageOutput}</dt><dd>{formatTokenCount(record.outputTokens)}</dd></div><div><dt>{session.text.usageCache}</dt><dd>{formatTokenCount(record.cacheReadTokens + record.cacheWriteTokens)}</dd></div><div><dt>{session.text.usageRankApi}</dt><dd>{record.api}</dd></div></dl></article>{/each}</div>
    {/if}
    <div class="observatory-pagination"><span>{session.text.usagePage.replace("{page}", String(usage.records.page)).replace("{pages}", String(totalPages)).replace("{total}", String(usage.records.total))}</span><div><label>{session.text.usagePageSize}<SelectControl value={String(usageStore.query.pageSize)} ariaLabel={session.text.usagePageSize} options={[10, 20, 50, 100].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => updateUsageQuery({ pageSize: Number(value) })} /></label><button class="secondary-button" type="button" disabled={usage.records.page <= 1 || usageStore.refreshing} onclick={() => updateUsageQuery({ page: usage.records.page - 1 }, false)}>{session.text.usagePrevious}</button><button class="secondary-button" type="button" disabled={usage.records.page >= totalPages || usageStore.refreshing} onclick={() => updateUsageQuery({ page: usage.records.page + 1 }, false)}>{session.text.usageNext}</button></div></div>
  </div>
      </div>
    </details>
  </div>
{/if}
