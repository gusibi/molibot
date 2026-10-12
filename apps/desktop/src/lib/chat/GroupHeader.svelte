<script lang="ts">
  import type { Snippet } from "svelte";
  import ChatPlus from "reicon-svelte/icons/ChatPlus";
  import Folder from "../icons/duotone/components/Folder.svelte";
  import FolderOpen from "../icons/duotone/components/FolderOpen.svelte";
  import More from "../icons/duotone/components/More.svelte";
  import Notebook from "../icons/duotone/components/Notebook.svelte";

  const GROUP_ICONS = { folder: Folder, notebook: Notebook } as const;

  let {
    label,
    avatar,
    status,
    active = false,
    icon = "folder",
    open = false,
    expandable = true,
    onToggle,
    actionLabel = "",
    onAction = null,
    menuLabel = "",
    onMenu = null
  }: {
    label: string;
    avatar?: Snippet;
    status?: Snippet;
    active?: boolean;
    icon?: keyof typeof GROUP_ICONS;
    open?: boolean;
    expandable?: boolean;
    onToggle: () => void;
    actionLabel?: string;
    onAction?: (() => void) | null;
    menuLabel?: string;
    onMenu?: (() => void) | null;
  } = $props();

  // A folder group mirrors its expansion state: open folder while expanded,
  // plain folder while collapsed. Non-folder groups keep a single glyph.
  // $derived (not legacy `$:`) — the dynamic <GroupIcon> mount below only
  // swaps when the component reference is a runes-derived signal.
  const GroupIcon = $derived(icon === "folder" && open ? FolderOpen : GROUP_ICONS[icon]);
</script>

<div class="conv-group-head" class:open class:active>
  <button class="conv-group-toggle" type="button" aria-current={active ? "page" : undefined} aria-expanded={expandable ? open : undefined} onclick={onToggle}>
    <span class="conv-group-tile" aria-hidden="true">{#if avatar}{@render avatar()}{:else}<GroupIcon class="conv-group-icon" size={16} weight="Filled" />{/if}</span>
    <span class="conv-group-label">{label}</span>
    {#if status}{@render status()}{/if}
  </button>
  {#if onAction}
    <button
      type="button"
      class="conv-group-action conv-group-menu"
      aria-label={actionLabel}
      title={actionLabel}
      onclick={() => onAction?.()}
    >
      <ChatPlus size={14} aria-hidden="true" />
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
</div>
