<script lang="ts">
  import { tick } from "svelte";

  export let open = false;
  export let value = "";
  export let placeholder = "";
  export let matchCount = 0;
  export let activeIndex = 0;
  export let noMatchesLabel = "";
  export let previousLabel = "";
  export let nextLabel = "";
  export let closeLabel = "";
  export let onInput: () => void;
  export let onPrevious: () => void;
  export let onNext: () => void;
  export let onClose: () => void;

  let input: HTMLInputElement;
  let wasOpen = false;
  $: if (open !== wasOpen) {
    wasOpen = open;
    if (open) void tick().then(() => input?.focus());
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || matchCount === 0) return;
    event.preventDefault();
    if (event.shiftKey) onPrevious();
    else onNext();
  }
</script>

<div class:open class="search-bar" role="search" aria-hidden={!open} inert={!open}>
  <i class="ph ph-magnifying-glass search-bar-icon" aria-hidden="true"></i>
  <input
    bind:this={input}
    type="search"
    bind:value
    {placeholder}
    aria-label={placeholder}
    oninput={onInput}
    onkeydown={onKeydown}
  />
  <span class="search-count" aria-live="polite">
    {value.trim() ? (matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : noMatchesLabel) : ""}
  </span>
  <div class="search-actions">
    <button type="button" aria-label={previousLabel} title={previousLabel} disabled={matchCount === 0} onclick={onPrevious}>
      <i class="ph ph-caret-up" aria-hidden="true"></i>
    </button>
    <button type="button" aria-label={nextLabel} title={nextLabel} disabled={matchCount === 0} onclick={onNext}>
      <i class="ph ph-caret-down" aria-hidden="true"></i>
    </button>
    <button type="button" aria-label={closeLabel} title={closeLabel} onclick={onClose}>
      <i class="ph ph-x" aria-hidden="true"></i>
    </button>
  </div>
</div>
