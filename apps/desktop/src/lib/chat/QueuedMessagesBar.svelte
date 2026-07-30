<script lang="ts">
  export let queued: string[] = [];
  export let label: string;
  export let removeLabel: string;
  export let onRemove: (index: number) => void;
  /** Steering is only offered while a turn is actually running. */
  export let canSteer = false;
  export let steerLabel = "";
  export let onSteer: ((index: number) => void) | null = null;
</script>

{#if queued.length > 0}
  <div class="queued-messages">
    <div class="queued-messages-head"><span class="queued-status-dot" aria-hidden="true"></span><strong>{label}</strong><span>{queued.length}</span></div>
    {#each queued as item, index (index)}
      <div class="queued-message-row" class:has-steer={Boolean(onSteer)}>
        <span class="queued-position">{index + 1}</span>
        <span class="queued-message-text" title={item}>{item}</span>
        {#if onSteer}
          <button
            type="button"
            class="queued-steer"
            aria-label={steerLabel}
            title={steerLabel}
            disabled={!canSteer}
            onclick={() => onSteer?.(index)}
          ><i class="ph ph-steering-wheel" aria-hidden="true"></i></button>
        {/if}
        <button type="button" aria-label={removeLabel} title={removeLabel} onclick={() => onRemove(index)}><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
    {/each}
  </div>
{/if}
