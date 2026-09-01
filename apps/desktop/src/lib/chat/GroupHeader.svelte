<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import Folder from "reicon-svelte/icons/Folder";
  import More from "reicon-svelte/icons/More";
  import Notebook from "reicon-svelte/icons/Notebook";
  import Plus from "reicon-svelte/icons/Plus";

  const GROUP_ICONS = { folder: Folder, notebook: Notebook } as const;

  export let label: string;
  export let icon: keyof typeof GROUP_ICONS = "folder";
  export let open = false;
  export let onToggle: () => void;
  export let actionLabel = "";
  export let onAction: (() => void) | null = null;
  export let menuLabel = "";
  export let onMenu: (() => void) | null = null;

  $: GroupIcon = GROUP_ICONS[icon];
</script>

<div class="conv-group-head" class:open>
  <button class="conv-group-toggle" type="button" aria-expanded={open} onclick={onToggle}>
    <span class="conv-group-tile" aria-hidden="true"><GroupIcon class="conv-group-icon" size={16} weight="Filled" /></span>
    <span class="conv-group-label">{label}</span>
  </button>
  {#if onAction}
    <button
      type="button"
      class="conv-group-action conv-group-menu"
      aria-label={actionLabel}
      title={actionLabel}
      onclick={() => onAction?.()}
    >
      <Plus size={14} aria-hidden="true" />
    </button>
  {/if}
  {#if onMenu}
    <button
      type="button"
      class="conv-group-action"
      aria-label={menuLabel}
      aria-haspopup="menu"
      title={menuLabel}
      onclick={() => onMenu?.()}
    >
      <More size={14} weight="Filled" aria-hidden="true" />
    </button>
  {/if}
  <button class="conv-caret-button" type="button" aria-label={label} aria-expanded={open} onclick={onToggle}>
    <AngleDown class={open ? "conv-caret open" : "conv-caret"} size={12} weight="Filled" aria-hidden="true" />
  </button>
</div>
