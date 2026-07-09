<script lang="ts">
  export let queued: string[] = [];
  export let label: string;
  export let removeLabel: string;
  export let onRemove: (index: number) => void;
</script>

{#if queued.length > 0}
  <div class="queued-messages">
    <span class="queued-badge">{label} · {queued.length}</span>
    {#each queued as item, index (index)}
      <span class="pending-chip">
        <span class="pending-name" title={item}>{item}</span>
        <button type="button" aria-label={removeLabel} onclick={() => onRemove(index)}>×</button>
      </span>
    {/each}
  </div>
{/if}
