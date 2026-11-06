<script lang="ts">
  import ArrowRightUp from "reicon-svelte/icons/ArrowRightUp";
  import ChevronDown from "reicon-svelte/icons/ChevronDown";
  import X from "reicon-svelte/icons/X";
  export let queued: string[] = [];
  export let label: string;
  /** Ordering hint shown on the header's trailing edge. */
  export let hint = "";
  export let removeLabel: string;
  /** Two-step confirm: first click arms, second click removes. Falls back to `removeLabel`. */
  export let confirmLabel = "";
  /** Fold copy; `{count}` is the number of rows kept behind the expander. */
  export let expandLabel = "";
  export let collapseLabel = "";
  export let onRemove: (index: number) => void;
  /** Steering is only offered while a turn is actually running. */
  export let canSteer = false;
  export let steerLabel = "";
  export let onSteer: ((index: number) => void) | null = null;

  /**
   * The shelf never scrolls: a scrollbar inside a secondary surface is noise,
   * and a scroll container here also clipped rows mid-height. Instead the first
   * few rows render in full and the rest fold behind one expander row, so the
   * composer keeps a bounded footprint no matter how many follow-ups pile up.
   */
  const COLLAPSED_ROWS = 3;

  let expanded = false;
  let confirmingRemove = "";

  $: foldedCount = expanded ? 0 : Math.max(0, queued.length - COLLAPSED_ROWS);
  $: visibleQueued = foldedCount > 0 ? queued.slice(0, COLLAPSED_ROWS) : queued;
  // A queue that drains back under the fold re-collapses on its own; leaving it
  // expanded would make the next short queue open in a state the user never set.
  $: if (queued.length <= COLLAPSED_ROWS) expanded = false;

  // A row removed elsewhere (drain, steer) shifts indices; never let the armed
  // confirm follow the wrong message.
  $: if (confirmingRemove !== "" && Number(confirmingRemove) >= queued.length) confirmingRemove = "";

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
  <div class="queued-messages" role="group" aria-label={label}>
    <div class="queued-messages-head">
      <span class="queued-status-dot" aria-hidden="true"></span>
      <strong>{label}</strong>
      <span class="queued-count">{queued.length}</span>
      {#if hint}<span class="queued-hint">{hint}</span>{/if}
    </div>
    <div class="queued-list" role="list">
      {#each visibleQueued as item, index (index)}
        <div class="queued-message-row" role="listitem">
          <span class="queued-position" aria-hidden="true">{index + 1}</span>
          <span class="queued-message-text" title={item}>{item}</span>
          <div class="queued-actions">
            {#if onSteer}
              <button
                type="button"
                class="queued-steer"
                aria-label={steerLabel}
                title={steerLabel}
                disabled={!canSteer}
                onclick={() => onSteer?.(index)}
              ><ArrowRightUp size={14} aria-hidden="true" /></button>
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
              {#if confirmingRemove === String(index)}{confirmLabel || removeLabel}{:else}<X size={14} aria-hidden="true" />{/if}
            </button>
          </div>
        </div>
      {/each}
    </div>
    {#if queued.length > COLLAPSED_ROWS}
      <button
        type="button"
        class="queued-toggle"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        <ChevronDown class="queued-toggle-icon" size={14} aria-hidden="true" />
        {#if expanded}
          {collapseLabel}
        {:else}
          {expandLabel.replace("{count}", String(queued.length - COLLAPSED_ROWS))}
        {/if}
      </button>
    {/if}
  </div>
{/if}
