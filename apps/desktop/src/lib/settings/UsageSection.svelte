<script lang="ts">
  import { untrack } from "svelte";
  import type { DesktopUsageRange } from "@molibot/desktop-contract";
  import { formatTokenCount } from "../api";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { formatNaturalDateTime, humanizeModelOption } from "../presentation";
  import { session } from "../stores/session.svelte";
  import { USAGE_RANGES, loadUsage, resetUsageFilters, updateUsageQuery, usageStore, usageWindowLabel } from "../stores/usage.svelte";
  import { DONUT_R, donutSegments, percentOf, trendAreaPath, trendLinePath } from "./charts";

  type RankingView = "apis" | "models" | "bots" | "channels";
  let rankingView = $state<RankingView>("models");

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => {
      if (endpoint !== usageStore.endpoint) void loadUsage(endpoint);
    });
  });

  const usage = $derived(usageStore.usage);
  const trend = $derived(usage?.trend ?? []);
  const tokenMax = $derived(Math.max(1, ...trend.map((point) => point.totalTokens)));
  const requestMax = $derived(Math.max(1, ...trend.map((point) => point.requests)));
  const cacheRatios = $derived(trend.map((point) => {
    const base = point.inputTokens + point.cacheReadTokens;
    return base > 0 ? Math.round(point.cacheReadTokens / base * 100) : 0;
  }));
  const tokenLine = $derived(trendLinePath(trend.map((point) => point.totalTokens), tokenMax));
  const tokenArea = $derived(trendAreaPath(tokenLine));
  const requestLine = $derived(trendLinePath(trend.map((point) => point.requests), requestMax));
  const cacheLine = $derived(trendLinePath(cacheRatios, 100));
  const cacheArea = $derived(trendAreaPath(cacheLine));
  const distribution = $derived(usage ? [
    { key: "input", label: session.text.usageInput, value: usage.totals.inputTokens, color: "var(--chart-blue)" },
    { key: "output", label: session.text.usageOutput, value: usage.totals.outputTokens, color: "var(--chart-teal)" },
    { key: "cacheRead", label: session.text.usageCacheRead, value: usage.totals.cacheReadTokens, color: "var(--chart-purple)" },
    { key: "cacheWrite", label: session.text.usageCacheWrite, value: usage.totals.cacheWriteTokens, color: "var(--chart-orange)" }
  ] : []);
  const distributionTotal = $derived(distribution.reduce((sum, item) => sum + item.value, 0));
  const distributionSegments = $derived(donutSegments(distribution));
  const cacheBase = $derived(usage ? usage.totals.inputTokens + usage.totals.cacheReadTokens : 0);
  const cacheHit = $derived(usage && cacheBase > 0 ? Math.round(usage.totals.cacheReadTokens / cacheBase * 100) : 0);
  const windowMax = $derived(usage ? Math.max(1, ...usage.windows.map((window) => window.totalTokens)) : 1);
  const averagePerDay = $derived(usage && trend.length > 0 ? usage.totals.totalTokens / trend.length : 0);
  const totalPages = $derived(usage ? Math.max(1, Math.ceil(usage.records.total / usage.records.pageSize)) : 1);
  const rankingRows = $derived(usage ? usage.rankings[rankingView] : []);

  const rankingTabs = $derived([
    { id: "models" as const, label: session.text.usageRankModel },
    { id: "apis" as const, label: session.text.usageRankApi },
    { id: "bots" as const, label: session.text.usageRankBot },
    { id: "channels" as const, label: session.text.usageRankChannel }
  ]);

  function formatDate(value: string): string {
    return formatNaturalDateTime(value, session.locale);
  }

  function rankingTitle(row: (typeof rankingRows)[number]): string {
    return "model" in row ? humanizeModelOption(`${row.provider}/${row.model}`, row.id).label : row.label;
  }

  function rankingSubtitle(row: (typeof rankingRows)[number]): string {
    return "model" in row ? `${row.provider} · ${row.api}` : `${formatTokenCount(row.requests)} ${session.text.usageRequests}`;
  }
</script>

{#if !session.serviceReady}
  <div class="settings-card"><EmptyState title={session.text.usageUnavailable} icon="chart-line" /></div>
{:else if usageStore.loading}
  <div class="settings-card"><SkeletonRows count={5} label={session.text.loading} /></div>
{:else if !usage}
  <div class="settings-card"><EmptyState title={session.text.usageEmpty} icon="chart-line" /></div>
{:else}
  <div class="settings-card observatory-filter-card">
    <div class="observatory-filter-head">
      <div><strong>{session.text.usageFilters}</strong><p>{usage.window.startDate} → {usage.window.endDate} · {usage.timezone}</p></div>
      <div class="observatory-filter-actions">
        <button class="secondary-button" type="button" onclick={resetUsageFilters}>{session.text.usageClearFilters}</button>
        <button class="secondary-button" type="button" disabled={usageStore.refreshing} onclick={() => session.endpoint && loadUsage(session.endpoint)}>{usageStore.refreshing ? session.text.usageRefreshing : session.text.usageRefresh}</button>
      </div>
    </div>
    <div class="observatory-filter-grid usage-filter-grid">
      <label class="observatory-field"><span>{session.text.traceRange}</span><SelectControl value={usageStore.query.range} ariaLabel={session.text.traceRange} options={USAGE_RANGES.map((range) => ({ value: range, label: usageWindowLabel(range, session.text) }))} onChange={(value) => updateUsageQuery({ range: value as DesktopUsageRange })} /></label>
      <label class="observatory-field"><span>{session.text.usageModel}</span><SelectControl value={usageStore.query.modelId} ariaLabel={session.text.usageModel} options={[{ value: "all", label: session.text.usageAllModels }, ...usage.options.models.map((item) => ({ value: item.id, label: humanizeModelOption(item.label, item.id).label }))]} onChange={(modelId) => updateUsageQuery({ modelId })} /></label>
      <label class="observatory-field"><span>{session.text.usageBot}</span><SelectControl value={usageStore.query.botId} ariaLabel={session.text.usageBot} options={[{ value: "all", label: session.text.usageAllBots }, ...usage.options.bots.map((bot) => ({ value: bot, label: bot }))]} onChange={(botId) => updateUsageQuery({ botId })} /></label>
      <label class="observatory-field"><span>{session.text.usageChannel}</span><SelectControl value={usageStore.query.channel} ariaLabel={session.text.usageChannel} options={[{ value: "all", label: session.text.usageAllChannels }, ...usage.options.channels.map((channel) => ({ value: channel, label: channel }))]} onChange={(channel) => updateUsageQuery({ channel })} /></label>
    </div>
    <p class="observatory-updated">{session.text.usageUpdatedAt} {formatDate(usage.generatedAt)}</p>
  </div>

  <div class="chart-kpi-grid">
    <div class="chart-kpi" style="--kpi-accent:var(--chart-blue)"><span class="chart-kpi-label">{session.text.usageRequests}</span><strong class="chart-kpi-value">{formatTokenCount(usage.totals.requests)}</strong><span class="chart-kpi-foot">{usageWindowLabel(usage.range, session.text)}</span></div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-teal)"><span class="chart-kpi-label">{session.text.usageTotalTokens}</span><strong class="chart-kpi-value">{formatTokenCount(usage.totals.totalTokens)}</strong><span class="chart-kpi-foot">{session.text.usageInput} {formatTokenCount(usage.totals.inputTokens)} · {session.text.usageOutput} {formatTokenCount(usage.totals.outputTokens)}</span></div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-purple)"><span class="chart-kpi-label">{session.text.usageCacheHitRatio}</span><strong class="chart-kpi-value">{cacheHit}%</strong><span class="chart-kpi-foot">{session.text.usageCacheRead} {formatTokenCount(usage.totals.cacheReadTokens)}</span></div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-orange)"><span class="chart-kpi-label">{session.text.usageAvgPerDay}</span><strong class="chart-kpi-value">{formatTokenCount(averagePerDay)}</strong><span class="chart-kpi-foot">{usageWindowLabel(usage.range, session.text)}</span></div>
  </div>

  <div class="settings-card chart-card">
    <div class="chart-card-head"><div><strong>{session.text.usageTrendTitle}</strong><p>{usage.range === "today" || usage.range === "yesterday" ? session.text.usageRequestTrend : usageWindowLabel(usage.range, session.text)}</p></div><div class="chart-legend-inline"><span class="legend-chip"><span class="legend-line" style="--dot:var(--chart-blue)"></span>{session.text.usageTotalTokens}</span><span class="legend-chip"><span class="legend-line legend-line-dash" style="--dot:var(--chart-teal)"></span>{session.text.usageRequests}</span></div></div>
    {#if trend.length > 0}
      <div class="trend-wrap"><svg class="trend-svg" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="usageFilteredFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-blue)" stop-opacity="0.26" /><stop offset="100%" stop-color="var(--chart-blue)" stop-opacity="0" /></linearGradient></defs><line class="trend-grid" x1="0" y1="5" x2="100" y2="5" vector-effect="non-scaling-stroke" /><line class="trend-grid" x1="0" y1="24.5" x2="100" y2="24.5" vector-effect="non-scaling-stroke" /><line class="trend-grid" x1="0" y1="40" x2="100" y2="40" vector-effect="non-scaling-stroke" /><path class="trend-area" d={tokenArea} fill="url(#usageFilteredFill)" /><path class="trend-line trend-line-req" d={requestLine} vector-effect="non-scaling-stroke" /><path class="trend-line trend-line-token" d={tokenLine} vector-effect="non-scaling-stroke" /></svg><div class="trend-axis"><span>{trend[0]?.label}</span><span>{trend[trend.length - 1]?.label}</span></div></div>
    {:else}<p class="chart-empty">{session.text.usageNoTrend}</p>{/if}
  </div>

  <div class="usage-detail-grid">
    <div class="settings-card chart-card">
      <div class="chart-card-head"><div><strong>{session.text.usageCacheTrend}</strong><p>{session.text.usageCacheTrendDesc}</p></div></div>
      <div class="trend-wrap compact-trend"><svg class="trend-svg" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="usageCacheFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--chart-purple)" stop-opacity="0.24" /><stop offset="100%" stop-color="var(--chart-purple)" stop-opacity="0" /></linearGradient></defs><line class="trend-grid" x1="0" y1="5" x2="100" y2="5" vector-effect="non-scaling-stroke" /><line class="trend-grid" x1="0" y1="40" x2="100" y2="40" vector-effect="non-scaling-stroke" /><path class="trend-area" d={cacheArea} fill="url(#usageCacheFill)" /><path class="trend-line usage-cache-line" d={cacheLine} vector-effect="non-scaling-stroke" /></svg><div class="trend-axis"><span>0%</span><span>100%</span></div></div>
    </div>
    <div class="settings-card chart-card">
      <div class="chart-card-head"><div><strong>{session.text.usageDistribution}</strong></div></div>
      <div class="donut-block"><div class="donut-wrap"><svg class="donut-svg" viewBox="0 0 42 42" role="img" aria-label={session.text.usageDistribution}><circle class="donut-track" cx="21" cy="21" r={DONUT_R} />{#each distributionSegments as segment (segment.key)}<circle class="donut-seg" cx="21" cy="21" r={DONUT_R} stroke={segment.color} stroke-dasharray="{segment.len} {100 - segment.len}" stroke-dashoffset={segment.offset} />{/each}</svg><div class="donut-center"><strong>{formatTokenCount(usage.totals.totalTokens)}</strong><small>{session.text.usageTokens}</small></div></div><ul class="chart-legend">{#each distribution as item (item.key)}<li><span class="legend-dot" style="background:{item.color}"></span><span class="legend-name">{item.label}</span><span class="legend-value">{formatTokenCount(item.value)}<em>{percentOf(item.value, distributionTotal)}%</em></span></li>{/each}</ul></div>
    </div>
  </div>

  <div class="settings-card chart-card">
    <div class="chart-card-head"><div><strong>{session.text.usageWindowCompare}</strong></div></div>
    <div class="window-bars">{#each usage.windows as window (window.label)}<div class="window-bar-row"><div class="window-bar-meta"><strong>{usageWindowLabel(window.label, session.text)}</strong><span>{formatTokenCount(window.requests)} {session.text.usageRequests}</span></div><div class="window-bar-track"><span class="window-seg" style="width:{percentOf(window.inputTokens, windowMax)}%;background:var(--chart-blue)"></span><span class="window-seg" style="width:{percentOf(window.outputTokens, windowMax)}%;background:var(--chart-teal)"></span><span class="window-seg" style="width:{percentOf(window.cacheReadTokens, windowMax)}%;background:var(--chart-purple)"></span><span class="window-seg" style="width:{percentOf(window.cacheWriteTokens, windowMax)}%;background:var(--chart-orange)"></span></div><span class="window-bar-total">{formatTokenCount(window.totalTokens)}</span></div>{/each}</div>
  </div>

  <div class="settings-card observatory-data-card">
    <div class="observatory-section-head"><div><strong>{session.text.usageRankings}</strong></div><div class="observatory-tabs" role="tablist">{#each rankingTabs as tab (tab.id)}<button type="button" role="tab" aria-selected={rankingView === tab.id} class:active={rankingView === tab.id} onclick={() => rankingView = tab.id}>{tab.label}</button>{/each}</div></div>
    {#if rankingRows.length === 0}<EmptyState title={session.text.usageNoRankings} icon="ranking" />{:else}<div class="observatory-ranking-list">{#each rankingRows.slice(0, 12) as row (row.id)}<div class="observatory-ranking-row"><div class="observatory-ranking-copy"><strong>{rankingTitle(row)}</strong><span>{rankingSubtitle(row)}</span></div><div class="observatory-ranking-meter"><span style="width:{percentOf(row.totalTokens, rankingRows[0]?.totalTokens ?? 1)}%"></span></div><div class="observatory-ranking-value"><strong>{formatTokenCount(row.totalTokens)}</strong><span>{session.text.usageTokens}</span></div></div>{/each}</div>{/if}
  </div>

  <div class="settings-card observatory-data-card">
    <div class="observatory-section-head"><div><strong>{session.text.usageRecentRequests}</strong><p>{session.text.usageRecentRequestsHint}</p></div></div>
    {#if usage.records.items.length === 0}<EmptyState title={session.text.usageNoRecords} icon="list-magnifying-glass" />{:else}
      <div class="observatory-table-wrap"><table class="observatory-table"><thead><tr><th>{session.text.usageTime}</th><th>{session.text.usageModel}</th><th>{session.text.usageChannel}</th><th>{session.text.usageBot}</th><th>{session.text.usageRankApi}</th><th>{session.text.usageInput}</th><th>{session.text.usageOutput}</th><th>{session.text.usageCache}</th><th>{session.text.usageTotalTokens}</th></tr></thead><tbody>{#each usage.records.items as record (record.ts + record.botId + record.model)}<tr><td>{formatDate(record.ts)}</td><td><strong>{humanizeModelOption(`${record.provider}/${record.model}`, `${record.provider}::${record.model}`).label}</strong><small>{record.provider}</small></td><td>{record.channel}</td><td class="observatory-id">{record.botId}</td><td class="observatory-id">{record.api}</td><td>{formatTokenCount(record.inputTokens)}</td><td>{formatTokenCount(record.outputTokens)}</td><td>{formatTokenCount(record.cacheReadTokens + record.cacheWriteTokens)}</td><td><strong>{formatTokenCount(record.totalTokens)}</strong></td></tr>{/each}</tbody></table></div>
      <div class="observatory-mobile-list">{#each usage.records.items as record (record.ts + record.botId + record.model)}<article><header><strong>{humanizeModelOption(`${record.provider}/${record.model}`, `${record.provider}::${record.model}`).label}</strong><span>{formatTokenCount(record.totalTokens)} {session.text.usageTokens}</span></header><p>{formatDate(record.ts)} · {record.channel} · {record.botId}</p><dl><div><dt>{session.text.usageInput}</dt><dd>{formatTokenCount(record.inputTokens)}</dd></div><div><dt>{session.text.usageOutput}</dt><dd>{formatTokenCount(record.outputTokens)}</dd></div><div><dt>{session.text.usageCache}</dt><dd>{formatTokenCount(record.cacheReadTokens + record.cacheWriteTokens)}</dd></div><div><dt>{session.text.usageRankApi}</dt><dd>{record.api}</dd></div></dl></article>{/each}</div>
    {/if}
    <div class="observatory-pagination"><span>{session.text.usagePage.replace("{page}", String(usage.records.page)).replace("{pages}", String(totalPages)).replace("{total}", String(usage.records.total))}</span><div><label>{session.text.usagePageSize}<SelectControl value={String(usageStore.query.pageSize)} ariaLabel={session.text.usagePageSize} options={[10, 20, 50, 100].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => updateUsageQuery({ pageSize: Number(value) })} /></label><button class="secondary-button" type="button" disabled={usage.records.page <= 1 || usageStore.refreshing} onclick={() => updateUsageQuery({ page: usage.records.page - 1 }, false)}>{session.text.usagePrevious}</button><button class="secondary-button" type="button" disabled={usage.records.page >= totalPages || usageStore.refreshing} onclick={() => updateUsageQuery({ page: usage.records.page + 1 }, false)}>{session.text.usageNext}</button></div></div>
  </div>
{/if}
