<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import AngleUp from "reicon-svelte/icons/AngleUp";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import X from "reicon-svelte/icons/X";
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
  <Magnifier class="search-bar-icon" size={14} aria-hidden="true" />
  <input
    bind:this={input}
    type="search"
    bind:value
    {placeholder}
    aria-label={placeholder}
    autocomplete="off"
    spellcheck="false"
    oninput={onInput}
    onkeydown={onKeydown}
  />
  <span class="search-count" aria-live="polite">
    {value.trim() ? (matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : noMatchesLabel) : ""}
  </span>
  <div class="search-actions">
    <button type="button" aria-label={previousLabel} title={previousLabel} disabled={matchCount === 0} onclick={onPrevious}>
      <AngleUp size={14} aria-hidden="true" />
    </button>
    <button type="button" aria-label={nextLabel} title={nextLabel} disabled={matchCount === 0} onclick={onNext}>
      <AngleDown size={14} aria-hidden="true" />
    </button>
    <button type="button" aria-label={closeLabel} title={closeLabel} onclick={onClose}>
      <X size={14} aria-hidden="true" />
    </button>
  </div>
</div>
