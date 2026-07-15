<script lang="ts">
  import { tick } from "svelte";

  export let label: string;

  let menu: HTMLDetailsElement;
  let trigger: HTMLElement;
  let open = false;

  function items(): HTMLButtonElement[] {
    return Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)') ?? []);
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
</script>

<details class="overflow-menu" bind:this={menu} ontoggle={(event) => (open = event.currentTarget.open)}>
  <summary bind:this={trigger} aria-label={label} title={label} onkeydown={onTriggerKeydown}><i class="ph ph-dots-three" aria-hidden="true"></i></summary>
  {#if open}<div class="overflow-menu-popover" role="menu" tabindex="-1" onkeydown={onMenuKeydown} onclick={onMenuClick}><slot /></div>{/if}
</details>
