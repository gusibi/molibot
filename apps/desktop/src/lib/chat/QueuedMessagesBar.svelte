<script lang="ts">
  export let queued: string[] = [];
  export let label: string;
  export let removeLabel: string;
  export let onRemove: (index: number) => void;
</script>

{#if queued.length > 0}
  <div class="queued-messages">
    <div class="queued-messages-head"><span class="queued-status-dot" aria-hidden="true"></span><strong>{label}</strong><span>{queued.length}</span></div>
    {#each queued as item, index (index)}
      <div class="queued-message-row">
        <span class="queued-position">{index + 1}</span>
        <span class="queued-message-text" title={item}>{item}</span>
        <button type="button" aria-label={removeLabel} title={removeLabel} onclick={() => onRemove(index)}><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
    {/each}
  </div>
{/if}
