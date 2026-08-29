<script lang="ts">
  export let queued: string[] = [];
  export let label: string;
  export let removeLabel: string;
  /** Two-step confirm: first click arms, second click removes. Falls back to `removeLabel`. */
  export let confirmLabel = "";
  export let onRemove: (index: number) => void;
  /** Steering is only offered while a turn is actually running. */
  export let canSteer = false;
  export let steerLabel = "";
  export let onSteer: ((index: number) => void) | null = null;

  let confirmingRemove = "";

  function toggleRemove(index: number): void {
    const id = String(index);
    if (confirmingRemove === id) {
      confirmingRemove = "";
      onRemove(index);
      return;
    }
    confirmingRemove = id;
  }
</script>

{#if queued.length > 0}
  <div class="queued-messages">
    <div class="queued-messages-head"><span class="queued-status-dot" aria-hidden="true"></span><strong>{label}</strong><span>{queued.length}</span></div>
    {#each queued as item, index (index)}
      <div
        class="queued-message-row"
        class:has-steer={Boolean(onSteer)}
        style={confirmingRemove === String(index) ? `grid-template-columns: 22px minmax(0, 1fr) auto${onSteer ? " auto" : ""}` : undefined}
      >
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
        <button
          type="button"
          class="queued-remove"
          class:confirm={confirmingRemove === String(index)}
          aria-label={confirmingRemove === String(index) ? (confirmLabel || removeLabel) : removeLabel}
          title={confirmingRemove === String(index) ? (confirmLabel || removeLabel) : removeLabel}
          onclick={() => toggleRemove(index)}
          onblur={() => (confirmingRemove = "")}
        >
          {#if confirmingRemove === String(index)}{confirmLabel || removeLabel}{:else}<i class="ph ph-x" aria-hidden="true"></i>{/if}
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  /* Armed state: the remove button grows into a text confirm so the second
     click is deliberate; the row's last grid column stretches via inline style. */
  .queued-remove.confirm {
    width: auto;
    min-width: 24px;
    height: 22px;
    padding: 0 7px;
    border-radius: var(--rounded-sm, 6px);
    color: var(--danger);
    font-size: var(--fs-meta);
    white-space: nowrap;
  }
  .queued-remove.confirm:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }
</style>
