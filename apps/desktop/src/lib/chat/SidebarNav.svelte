<script lang="ts">
  export let ariaLabel: string;
  export let items: Array<{
    id: string;
    label: string;
    icon: string;
    active?: boolean;
    onClick: () => void;
  }> = [];
</script>

<nav class="sidebar-nav" aria-label={ariaLabel}>
  {#each items as item (item.id)}
    <button type="button" class="nav-item" class:active={item.active} onclick={item.onClick}>
      <i class={`ph ${item.icon}`} aria-hidden="true"></i>
      <span>{item.label}</span>
    </button>
  {/each}
</nav>
