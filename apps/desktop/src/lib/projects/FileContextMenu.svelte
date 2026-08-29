<script lang="ts">
  import { tick } from "svelte";
  import type { FileMenuItem } from "./fileMenu";

  let { x, y, items, onSelect, onClose }: {
    x: number;
    y: number;
    items: FileMenuItem[];
    onSelect: (id: string) => void;
    onClose: () => void;
  } = $props();

  const MARGIN = 8;

  let menu = $state<HTMLDivElement | null>(null);
  /** Until the menu has been measured it sits at the raw click point, so it never flashes at 0,0. */
  let placed = $state(false);
  let left = $state(0);
  let top = $state(0);
  let cursor = $state(-1);

  const enabled = $derived(items.filter((item) => !item.disabled));

  // Flip the menu back inside the window instead of letting it clip at the edge,
  // which is what AppKit does for a context menu opened near a corner.
  $effect(() => {
    const anchorX = x;
    const anchorY = y;
    void tick().then(() => {
      const box = menu?.getBoundingClientRect();
      if (!box) return;
      left = Math.max(MARGIN, Math.min(anchorX, window.innerWidth - box.width - MARGIN));
      top = Math.max(MARGIN, Math.min(anchorY, window.innerHeight - box.height - MARGIN));
      placed = true;
      menu?.focus();
    });
  });

  function choose(item: FileMenuItem): void {
    if (item.disabled) return;
    onSelect(item.id);
    onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!enabled.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      cursor = (cursor + delta + enabled.length) % enabled.length;
      return;
    }
    if (event.key === "Enter" && cursor >= 0) {
      event.preventDefault();
      choose(enabled[cursor]);
    }
  }
</script>

<svelte:window onresize={onClose} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="file-menu-backdrop" role="presentation" aria-hidden="true" onclick={onClose} oncontextmenu={(event) => { event.preventDefault(); onClose(); }}></div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="file-menu"
  role="menu"
  tabindex="-1"
  bind:this={menu}
  style={`left:${placed ? left : x}px; top:${placed ? top : y}px`}
  onkeydown={onKeydown}
>
  {#each items as item (item.id)}
    {#if item.startsGroup}<div class="file-menu-separator" role="separator"></div>{/if}
    <button
      type="button"
      role="menuitem"
      class="file-menu-item"
      class:cursor={enabled[cursor]?.id === item.id}
      disabled={item.disabled}
      onclick={() => choose(item)}
      onmouseenter={() => (cursor = enabled.findIndex((candidate) => candidate.id === item.id))}
    >
      <i class={`ph ${item.icon}`} aria-hidden="true"></i>
      <span>{item.label}</span>
    </button>
  {/each}
</div>
