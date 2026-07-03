<script lang="ts">
  import { formatTokenCount } from "../api";
  import { session } from "../stores/session.svelte";
  import { usageStore, loadUsage, usageWindowLabel } from "../stores/usage.svelte";
  import { DONUT_R, donutSegments, percentOf, trendAreaPath, trendLinePath, trendY } from "./charts";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== usageStore.endpoint) {
      void loadUsage(session.endpoint);
    }
  });

  const usage = $derived(usageStore.usage);
  const usageDaily = $derived(usage?.daily ?? []);
  const usageHasTrend = $derived(usageDaily.length >= 1);
  const usageTokenMax = $derived(Math.max(1, ...usageDaily.map((day) => day.totalTokens)));
  const usageReqMax = $derived(Math.max(1, ...usageDaily.map((day) => day.requests)));
  const usageTokenLine = $derived(trendLinePath(usageDaily.map((day) => day.totalTokens), usageTokenMax));
  const usageTokenArea = $derived(trendAreaPath(usageTokenLine));
  const usageReqLine = $derived(trendLinePath(usageDaily.map((day) => day.requests), usageReqMax));
  const usagePeakIndex = $derived(usageDaily.reduce((best, day, index) => (day.totalTokens > (usageDaily[best]?.totalTokens ?? -1) ? index : best), 0));
  const usagePeakDay = $derived(usageDaily[usagePeakIndex] ?? null);
  const usagePeakX = $derived(usageDaily.length > 1 ? (usagePeakIndex / (usageDaily.length - 1)) * 100 : 0);
  // Keep the floating peak label inside the card even when the peak sits at an edge.
  const usagePeakTagX = $derived(Math.min(90, Math.max(10, usagePeakX)));
  const usageDistItems = $derived(usage
    ? [
        { key: "input", label: session.text.usageInput, value: usage.totals.inputTokens, color: "var(--chart-blue)" },
        { key: "output", label: session.text.usageOutput, value: usage.totals.outputTokens, color: "var(--chart-teal)" },
        { key: "cacheRead", label: session.text.usageCacheRead, value: usage.totals.cacheReadTokens, color: "var(--chart-purple)" },
        { key: "cacheWrite", label: session.text.usageCacheWrite, value: usage.totals.cacheWriteTokens, color: "var(--chart-orange)" }
      ]
    : []);
  const usageDistTotal = $derived(usageDistItems.reduce((sum, item) => sum + item.value, 0));
  const usageDistSegments = $derived(donutSegments(usageDistItems));
  const usageCacheBase = $derived(usage ? usage.totals.inputTokens + usage.totals.cacheReadTokens : 0);
  const usageCacheHit = $derived(usage && usageCacheBase > 0 ? usage.totals.cacheReadTokens / usageCacheBase : 0);
  const usageWindowMax = $derived(usage ? Math.max(1, ...usage.windows.map((window) => window.totalTokens)) : 1);
  const usageAvgPerDay = $derived(usageDaily.length > 0 && usage ? usage.totals.totalTokens / 30 : 0);
</script>

<p class="settings-section-hint">{session.text.usageHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.usageUnavailable}</p></div></div>
{:else if usageStore.loading}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else if !usage}
  <div class="settings-card"><div class="settings-row"><p>{session.text.usageEmpty}</p></div></div>
{:else}
  <div class="chart-kpi-grid">
    <div class="chart-kpi" style="--kpi-accent:var(--chart-blue)">
      <span class="chart-kpi-label">{session.text.usageRequests}</span>
      <strong class="chart-kpi-value">{formatTokenCount(usage.totals.requests)}</strong>
      <span class="chart-kpi-foot">{session.text.usageWindow_last30Days}</span>
    </div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-teal)">
      <span class="chart-kpi-label">{session.text.usageTotalTokens}</span>
      <strong class="chart-kpi-value">{formatTokenCount(usage.totals.totalTokens)}</strong>
      <span class="chart-kpi-foot">{session.text.usageInput} {formatTokenCount(usage.totals.inputTokens)} · {session.text.usageOutput} {formatTokenCount(usage.totals.outputTokens)}</span>
    </div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-purple)">
      <span class="chart-kpi-label">{session.text.usageCacheHitRatio}</span>
      <strong class="chart-kpi-value">{Math.round(usageCacheHit * 100)}%</strong>
      <span class="chart-kpi-foot">{session.text.usageCacheRead} {formatTokenCount(usage.totals.cacheReadTokens)}</span>
    </div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-orange)">
      <span class="chart-kpi-label">{session.text.usageAvgPerDay}</span>
      <strong class="chart-kpi-value">{formatTokenCount(usageAvgPerDay)}</strong>
      <span class="chart-kpi-foot">{session.text.usageWindow_last30Days}</span>
    </div>
  </div>

  <div class="settings-card chart-card">
    <div class="chart-card-head">
      <div><strong>{session.text.usageTrendTitle}</strong><p>{session.text.usageTrendDesc}</p></div>
      <div class="chart-legend-inline">
        <span class="legend-chip"><span class="legend-line" style="--dot:var(--chart-blue)"></span>{session.text.usageTotalTokens}</span>
        <span class="legend-chip"><span class="legend-line legend-line-dash" style="--dot:var(--chart-teal)"></span>{session.text.usageRequests}</span>
      </div>
    </div>
    {#if usageHasTrend}
      <div class="trend-wrap">
        <svg class="trend-svg" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="usageTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--chart-blue)" stop-opacity="0.26" />
              <stop offset="100%" stop-color="var(--chart-blue)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line class="trend-grid" x1="0" y1="5" x2="100" y2="5" vector-effect="non-scaling-stroke" />
          <line class="trend-grid" x1="0" y1="24.5" x2="100" y2="24.5" vector-effect="non-scaling-stroke" />
          <line class="trend-grid" x1="0" y1="40" x2="100" y2="40" vector-effect="non-scaling-stroke" />
          <path class="trend-area" d={usageTokenArea} fill="url(#usageTrendFill)" />
          <path class="trend-line trend-line-req" d={usageReqLine} vector-effect="non-scaling-stroke" />
          <path class="trend-line trend-line-token" d={usageTokenLine} vector-effect="non-scaling-stroke" />
          {#if usagePeakDay && usageDaily.length > 1}<line class="trend-peak-guide" x1={usagePeakX} y1="0" x2={usagePeakX} y2="44" vector-effect="non-scaling-stroke" />{/if}
        </svg>
        {#if usagePeakDay && usageDaily.length > 1}
          <div class="trend-peak-tag" style="left:{usagePeakTagX}%">
            <strong>{formatTokenCount(usagePeakDay.totalTokens)}</strong>
            <small>{session.text.usagePeak} · {usagePeakDay.date.slice(5)}</small>
          </div>
        {/if}
        <div class="trend-axis">
          <span>{usageDaily[0]?.date.slice(5)}</span>
          <span>{usageDaily[usageDaily.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    {:else}
      <p class="chart-empty">{session.text.usageNoTrend}</p>
    {/if}
    <p class="chart-caption">{session.text.usageGeneratedAt}: {usage.generatedAt.slice(0, 19).replace("T", " ")} · {usage.timezone}</p>
  </div>

  <div class="usage-split">
    <div class="settings-card chart-card">
      <div class="chart-card-head"><div><strong>{session.text.usageDistribution}</strong></div></div>
      <div class="donut-block">
        <div class="donut-wrap">
          <svg class="donut-svg" viewBox="0 0 42 42" role="img" aria-label={session.text.usageDistribution}>
            <circle class="donut-track" cx="21" cy="21" r={DONUT_R} />
            {#each usageDistSegments as seg (seg.key)}
              <circle class="donut-seg" cx="21" cy="21" r={DONUT_R} stroke={seg.color} stroke-dasharray="{seg.len} {100 - seg.len}" stroke-dashoffset={seg.offset} />
            {/each}
          </svg>
          <div class="donut-center">
            <strong>{formatTokenCount(usage.totals.totalTokens)}</strong>
            <small>{session.text.usageTotalTokens}</small>
          </div>
        </div>
        <ul class="chart-legend">
          {#each usageDistItems as item (item.key)}
            <li>
              <span class="legend-dot" style="background:{item.color}"></span>
              <span class="legend-name">{item.label}</span>
              <span class="legend-value">{formatTokenCount(item.value)}<em>{percentOf(item.value, usageDistTotal)}%</em></span>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <div class="settings-card chart-card">
      <div class="chart-card-head"><div><strong>{session.text.usageWindowCompare}</strong></div></div>
      <div class="window-bars">
        {#each usage.windows as window (window.label)}
          <div class="window-bar-row">
            <div class="window-bar-meta">
              <strong>{usageWindowLabel(window.label, session.text)}</strong>
              <span>{formatTokenCount(window.requests)} {session.text.usageRequests}</span>
            </div>
            <div class="window-bar-track" title={`${formatTokenCount(window.totalTokens)} ${session.text.usageTokens}`}>
              <span class="window-seg" style="width:{percentOf(window.inputTokens, usageWindowMax)}%; background:var(--chart-blue)"></span>
              <span class="window-seg" style="width:{percentOf(window.outputTokens, usageWindowMax)}%; background:var(--chart-teal)"></span>
              <span class="window-seg" style="width:{percentOf(window.cacheReadTokens, usageWindowMax)}%; background:var(--chart-purple)"></span>
              <span class="window-seg" style="width:{percentOf(window.cacheWriteTokens, usageWindowMax)}%; background:var(--chart-orange)"></span>
            </div>
            <span class="window-bar-total">{formatTokenCount(window.totalTokens)}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
