<script lang="ts">
  import { compactCount } from "./analytics";
  import { DONUT_R, donutSegments } from "./charts";
  import { session } from "../stores/session.svelte";
  let { title, items, unit }: { title: string; items: { key: string; label: string; value: number; color: string }[]; unit?: string } = $props();
  const patternId = $props.id();
  const total = $derived(items.reduce((sum, item) => sum + item.value, 0));
  const segments = $derived(donutSegments(items));
  const textured = $derived(items.find(item => item.key === "cacheRead" || item.key === "pending"));
  const description = $derived(items.map(item => `${item.label}: ${item.value.toLocaleString()}`).join("; "));
</script>

<div class="analytics-composition">
  <div class="analytics-ring">
    <svg viewBox="0 0 42 42" role="img" aria-label={`${title}. ${description}`}>
      {#if textured}<defs><pattern id={patternId} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="2" fill={textured.color} /><path d="M0 0V2" stroke="var(--card-bg)" stroke-width="0.6" opacity="0.45" /></pattern></defs>{/if}
      <circle class="analytics-ring-track" cx="21" cy="21" r={DONUT_R} />
      {#each segments as segment (segment.key)}<circle class="analytics-ring-segment" cx="21" cy="21" r={DONUT_R} stroke={segment.key === textured?.key ? `url(#${patternId})` : segment.color} stroke-dasharray={`${segment.len} ${100 - segment.len}`} stroke-dashoffset={segment.offset}><title>{segment.value.toLocaleString()} · {(segment.len).toFixed(1)}%</title></circle>{/each}
    </svg>
    <div class="analytics-ring-center"><strong title={total.toLocaleString()}>{compactCount(total)}</strong><small>{unit ?? session.text.usageTokens}</small></div>
  </div>
  <dl class="analytics-composition-legend">
    {#each items as item (item.key)}
      <div><dt><i data-analytics-segment={item.key} style={`background-color:${item.color}`} aria-hidden="true"></i>{item.label}</dt><dd title={item.value.toLocaleString()}>{compactCount(item.value)}<small>{total > 0 ? `${(item.value / total * 100).toFixed(1)}%` : "—"}</small></dd></div>
    {/each}
  </dl>
  {#if total === 0}<p class="analytics-caption">{session.text.analyticsNoData}</p>{/if}
</div>
