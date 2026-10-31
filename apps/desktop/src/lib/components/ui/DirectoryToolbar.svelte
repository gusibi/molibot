<script lang="ts">
  import type { Snippet } from "svelte";
  import SearchField from "./SearchField.svelte";
  import { session } from "../../stores/session.svelte";

  let { query, status, total, enabled, shown, searchLabel, onQuery, onStatus, summary = "", actions }: {
    query: string; status: "all" | "enabled" | "disabled"; total: number; enabled: number; shown: number;
    summary?: string; searchLabel: string; onQuery: (value: string) => void; onStatus: (value: "all" | "enabled" | "disabled") => void; actions?: Snippet;
  } = $props();
  const options = $derived([
    { id: "all" as const, label: session.text.directoryAll, count: total },
    { id: "enabled" as const, label: session.text.providerEnabled, count: enabled },
    { id: "disabled" as const, label: session.text.providerDisabled, count: total - enabled }
  ]);
</script>

<div class="directory-toolbar">
  <div class="directory-search-line"><SearchField value={query} label={searchLabel} placeholder={searchLabel} onInput={onQuery} />{#if actions}{@render actions()}{/if}</div>
  <div class="directory-filter-line">
    <div class="memory-center-tabs directory-status-tabs" role="group" aria-label={session.text.directoryStatusFilter}>
      {#each options as option}<button type="button" class:active={status === option.id} aria-pressed={status === option.id} onclick={() => onStatus(option.id)}>{option.label}<span>{option.count}</span></button>{/each}
    </div>
    <span class="directory-match-count" aria-live="polite">{#if summary}{summary} · {/if}{session.text.directoryMatches.replace("{shown}", String(shown)).replace("{total}", String(total))}</span>
  </div>
</div>
