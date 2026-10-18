<script lang="ts">
  import type { DesktopTraceTrendPoint } from "@molibot/desktop-contract";
  import Button from "../components/ui/Button.svelte";
  import { session } from "../stores/session.svelte";
  import { compactCount } from "./analytics";
  import { trendLinePath } from "./charts";

  let { points }: { points: DesktopTraceTrendPoint[] } = $props();
  type Series = "modelCalls" | "toolCalls" | "mcpCalls";
  let hidden = $state<Series[]>([]);
  let selectedKey = $state("");
  const series = $derived([
    { key: "modelCalls" as const, label: session.text.traceModelCalls, color: "var(--chart-blue)", dash: "" },
    { key: "toolCalls" as const, label: session.text.analyticsOrdinaryTools, color: "var(--chart-teal)", dash: "6 3" },
    { key: "mcpCalls" as const, label: session.text.analyticsMcpCalls, color: "var(--chart-orange)", dash: "2 3" }
  ]);
  const maximum = $derived(Math.max(1, ...points.flatMap(point => series.filter(item => !hidden.includes(item.key)).map(item => point[item.key]))));
  const selected = $derived(points.find(point => point.key === selectedKey) ?? points.at(-1));
  function toggle(key: Series): void { hidden = hidden.includes(key) ? hidden.filter(value => value !== key) : [...hidden, key]; }
  function describe(point: DesktopTraceTrendPoint): string { return `${point.label}: ${series.map(item => `${item.label} ${point[item.key]}`).join(" · ")}`; }
</script>

<section class="settings-card analytics-chart-panel" aria-label={session.text.analyticsCallTrend}>
  <header class="analytics-panel-head"><strong>{session.text.analyticsCallTrend}</strong><span>{session.text.traceCalls}</span></header>
  <div class="analytics-trend-legend" role="group" aria-label={session.text.analyticsCallTrend}>
    {#each series as item}<Button aria-pressed={!hidden.includes(item.key)} onclick={() => toggle(item.key)}><svg width="20" height="8" aria-hidden="true"><line x1="0" x2="20" y1="4" y2="4" stroke={item.color} stroke-width="2" stroke-dasharray={item.dash} /></svg>{item.label}<strong>{compactCount(points.reduce((sum, point) => sum + point[item.key], 0))}</strong></Button>{/each}
  </div>
  <div class="analytics-trend-plot">
    <div class="analytics-trend-scale" aria-hidden="true"><span>{compactCount(maximum)}</span><span>{maximum >= 2 ? compactCount(maximum / 2) : ""}</span><span>0</span></div>
    <div class="trend-wrap"><svg class="trend-svg" viewBox="0 0 100 44" preserveAspectRatio="none" role="group" aria-label={session.text.analyticsCallTrend}>
      {#each [5, 22.5, 40] as y}<line class="trend-grid" x1="0" y1={y} x2="100" y2={y} vector-effect="non-scaling-stroke" />{/each}
      {#each series.filter(item => !hidden.includes(item.key)) as item}<path class="analytics-trend-line" data-series={item.key} d={trendLinePath(points.map(point => point[item.key]), maximum)} style={`stroke:${item.color}`} stroke-dasharray={item.dash} vector-effect="non-scaling-stroke" />{/each}
      {#each points as point, index (point.key)}
        <g role="button" tabindex="0" aria-label={describe(point)} onclick={() => selectedKey = point.key} onfocus={() => selectedKey = point.key} onpointerenter={() => selectedKey = point.key} onkeydown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectedKey = point.key; } }}>
          <rect class="analytics-trend-hit" x={Math.max(0, (index - 0.5) / Math.max(1, points.length - 1) * 100)} y="0" width={Math.min(100, (index + 0.5) / Math.max(1, points.length - 1) * 100) - Math.max(0, (index - 0.5) / Math.max(1, points.length - 1) * 100)} height="44"><title>{describe(point)}</title></rect>
        </g>
      {/each}
    </svg><div class="trend-axis">{#each points.filter((_, index) => index === 0 || index === Math.floor(points.length / 2) || index === points.length - 1) as point}<span>{point.label}</span>{/each}</div></div>
  </div>
  {#if selected}<div class="analytics-trend-readout" role="status" aria-label={session.text.analyticsPointDetails}><strong>{selected.label}</strong>{#each series as item}<span>{item.label}<b>{selected[item.key].toLocaleString()}</b></span>{/each}</div>{/if}
  <p class="analytics-caption">{session.text.analyticsCallTrendHint}</p>
</section>
