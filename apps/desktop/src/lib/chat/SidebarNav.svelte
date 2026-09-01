<script lang="ts">
  import type { ReiconComponent } from "../components/ui/iconTypes";

  export let ariaLabel: string;
  export let items: Array<{
    id: string;
    label: string;
    icon: ReiconComponent;
    active?: boolean;
    onClick: () => void;
  }> = [];
</script>

<nav class="sidebar-nav" aria-label={ariaLabel}>
  {#each items as item (item.id)}
    {@const NavIcon = item.icon}
    <button type="button" class="nav-item" class:active={item.active} onclick={item.onClick}>
      <NavIcon size={16} aria-hidden="true" />
      <span>{item.label}</span>
    </button>
  {/each}
</nav>
