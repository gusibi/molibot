<script lang="ts">
  import More from "reicon-svelte/icons/More";
  import { onDestroy, tick } from "svelte";

  export let label: string;
  /**
   * Optional visible trigger content, via the `trigger` slot. The default is the
   * bare `⋯` glyph; callers that need a labelled trigger (a quiet "current
   * value ▾" control) pass their own so they get this component's dismiss,
   * Escape and arrow-key behaviour instead of re-implementing it.
   */
  export let variant: "icon" | "inline" = "icon";
  export let popoverRole: "menu" | "dialog" = "menu";
  export let closeOnPointerLeave = false;
  export let placement: "down" | "up" = "down";

  let menu: HTMLDetailsElement;
  let trigger: HTMLElement;
  let open = false;
  let pointerLeaveTimer: ReturnType<typeof setTimeout> | undefined;

  function items(): HTMLButtonElement[] {
    return Array.from(menu?.querySelectorAll<HTMLButtonElement>('.overflow-menu-popover button:not(:disabled)') ?? []);
  }

  async function onTriggerKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open = true;
    menu.open = true;
    await tick();
    const available = items();
    available[event.key === "ArrowUp" ? available.length - 1 : 0]?.focus();
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      open = false;
      menu.open = false;
      trigger.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const available = items();
    const current = available.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    available[(current + delta + available.length) % available.length]?.focus();
  }

  function onMenuClick(event: MouseEvent): void {
    if ((event.target as Element).closest("button")) {
      open = false;
      menu.open = false;
    }
  }

  function onPointerLeave(event: PointerEvent): void {
    if (!closeOnPointerLeave || event.pointerType !== "mouse" || !menu.open) return;
    clearTimeout(pointerLeaveTimer);
    pointerLeaveTimer = setTimeout(() => {
      open = false;
      menu.open = false;
    }, 120);
  }

  function onPointerEnter(): void {
    clearTimeout(pointerLeaveTimer);
  }

  onDestroy(() => clearTimeout(pointerLeaveTimer));
</script>

<details class={`overflow-menu overflow-menu-${variant} overflow-menu-${placement}`} bind:this={menu} ontoggle={(event) => (open = event.currentTarget.open)} onpointerenter={onPointerEnter} onpointerleave={onPointerLeave}>
  <summary bind:this={trigger} aria-label={label} title={label} onkeydown={onTriggerKeydown}>
    <slot name="trigger"><More class="overflow-menu-icon" size={16} aria-hidden="true" /></slot>
  </summary>
  {#if open}<div class="overflow-menu-popover" role={popoverRole} aria-label={label} tabindex="-1" onkeydown={onMenuKeydown} onclick={onMenuClick}><slot /></div>{/if}
</details>
