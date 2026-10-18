<script lang="ts">
  import EmptyState from "../components/ui/EmptyState.svelte";
  import Button from "../components/ui/Button.svelte";
  import { compactCount } from "./analytics";
  import { session } from "../stores/session.svelte";

  let { title, rows, unit, total, onselect }: {
    title: string;
    rows: { id: string; label: string; secondary?: string; value: number }[];
    unit: string;
    total: number;
    onselect?: (id: string) => void;
  } = $props();
  let expanded = $state(false);
  const visibleRows = $derived(expanded ? rows : rows.slice(0, 8));
</script>

<section class="settings-card analytics-ranking" aria-label={title}>
  <header class="analytics-panel-head"><strong>{title}</strong></header>
  {#if rows.length === 0}
    <EmptyState title={session.text.analyticsNoData} description={session.text.analyticsNoDataHint} icon="ranking" />
  {:else}
    <table class="analytics-rank-table">
      <colgroup><col /><col class="analytics-value-column" /><col class="analytics-share-column" /></colgroup>
      <thead><tr><th scope="col">{session.text.analyticsName}</th><th scope="col">{unit}</th><th scope="col">{session.text.analyticsShare}</th></tr></thead>
      <tbody>
        {#each visibleRows as row (row.id)}
          <tr>
            <td>
              {#if onselect}
                <button class="analytics-rank-button" type="button" title={`${row.label} · ${session.text.analyticsFiltered}`} onclick={() => onselect?.(row.id)}><strong>{row.label}</strong></button>
              {:else}<strong class="analytics-rank-name" title={row.label}>{row.label}</strong>{/if}
              {#if row.secondary}<small class="analytics-rank-secondary">{row.secondary}</small>{/if}
            </td>
            <td title={row.value.toLocaleString()}>{compactCount(row.value)}</td>
            <td>{total > 0 ? `${(row.value / total * 100).toFixed(1)}%` : "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if rows.length > 8}<Button class="analytics-show-all" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? session.text.analyticsShowLess : session.text.analyticsShowAll.replace("{count}", String(rows.length))}</Button>{/if}
  {/if}
</section>
