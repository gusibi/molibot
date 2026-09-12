<script lang="ts">
  import Copy from "../icons/duotone/components/Copy.svelte";
  import FolderOpen from "../icons/duotone/components/FolderOpen.svelte";
  import Pen from "../icons/duotone/components/Pen.svelte";
  import Trash from "../icons/duotone/components/Trash.svelte";
  import { tick } from "svelte";
  import { Portal } from "bits-ui";
  import BotAvatar from "./BotAvatar.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";

  type ConversationRowItem = Pick<DesktopConversationItem, "title" | "updatedAt" | "readOnly" | "botId" | "botName" | "botDeleted" | "parentSessionId">;

  let {
    item,
    active = false,
    statusDot = null,
    formatTime,
    labels,
    onSelect,
    onRename,
    onDelete,
    onCopyPath,
    onRevealInFinder
  }: {
    item: ConversationRowItem;
    active?: boolean;
    statusDot?: SessionStatusDot | null;
    formatTime: (iso: string) => string;
    labels: {
      running: string;
      waitingApproval: string;
      completed: string;
      failed: string;
      menu?: string;
      rename?: string;
      delete?: string;
      copyPath?: string;
      revealInFinder?: string;
      placeholder?: string;
      deletePrompt?: string;
      cancel?: string;
      forkedConversation?: string;
    };
    onSelect: () => void;
    onRename?: (title: string) => void;
    onDelete?: () => void;
    onCopyPath?: () => void | Promise<void>;
    onRevealInFinder?: () => void | Promise<void>;
  } = $props();

  const canRename = $derived(!item.readOnly && Boolean(onRename));
  const canDelete = $derived(!item.readOnly && Boolean(onDelete));
  const canContextMenu = $derived(canRename || canDelete || Boolean(onCopyPath) || Boolean(onRevealInFinder));

  let menuOpen = $state(false);
  let menuPos = $state({ top: 0, left: 0 });
  let menuEl: HTMLDivElement | null = $state(null);
  let confirmingDelete = $state(false);

  let editing = $state(false);
  let draftTitle = $state("");
  let inputEl: HTMLInputElement | null = $state(null);

  const MENU_WIDTH = 180;
  const MENU_HEIGHT = 160;
  const MARGIN = 8;

  /** Focuses the menu container when it mounts so Escape/arrow keys work immediately. */
  function autofocus(node: HTMLElement): void {
    node.focus();
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      menuOpen = false;
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = Array.from(menuEl?.querySelectorAll<HTMLButtonElement>(".row-menu-item") ?? []);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus();
    }
  }

  function onContextMenu(event: MouseEvent): void {
    if (editing) return;
    event.preventDefault();
    event.stopPropagation();
    menuPos = {
      top: Math.max(MARGIN, Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - MARGIN)),
      left: Math.max(MARGIN, Math.min(event.clientX, window.innerWidth - MENU_WIDTH - MARGIN))
    };
    confirmingDelete = false;
    menuOpen = true;
  }

  function onWindowPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".row-menu")) return;
    menuOpen = false;
  }

  // Reset the delete-confirm step whenever the menu is dismissed.
  $effect(() => {
    if (!menuOpen) confirmingDelete = false;
  });

  $effect(() => {
    if (!menuOpen) return;
    const close = () => (menuOpen = false);
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    window.addEventListener("resize", close);
    // The menu is fixed-positioned; close it when the list scrolls out from under it.
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onWindowPointerDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  });

  async function handleCopyPath(): Promise<void> {
    menuOpen = false;
    await onCopyPath?.();
  }

  async function handleRevealInFinder(): Promise<void> {
    menuOpen = false;
    await onRevealInFinder?.();
  }

  async function startRename(): Promise<void> {
    menuOpen = false;
    draftTitle = item.title;
    editing = true;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  function commitRename(): void {
    if (!editing) return;
    editing = false;
    const next = draftTitle.trim();
    if (next && next !== item.title) onRename?.(next);
  }

  function cancelRename(): void {
    editing = false;
  }

  function onEditKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  function askDelete(): void {
    confirmingDelete = true;
  }

  function confirmDelete(): void {
    menuOpen = false;
    confirmingDelete = false;
    onDelete?.();
  }

  function onRowClick(): void {
    if (editing) return;
    onSelect();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="conversation-row"
  class:active
  class:menu-open={menuOpen}
  class:forked={Boolean(item.parentSessionId)}
  data-read-only={item.readOnly}
  oncontextmenu={canContextMenu ? onContextMenu : undefined}
>
  {#if editing}
    <input
      class="row-rename-input"
      bind:this={inputEl}
      bind:value={draftTitle}
      placeholder={labels.placeholder}
      aria-label={labels.rename}
      onkeydown={onEditKeydown}
      onblur={commitRename}
    />
  {:else}
    <button type="button" class="row-open" title={item.title} onclick={onRowClick}>
      <span class="row-avatar">
        {#if item.parentSessionId}
          <span class="row-branch" aria-label={labels.forkedConversation} title={labels.forkedConversation}>↳</span>
        {/if}
        <BotAvatar botId={item.botId} name={item.botDeleted ? "" : item.botName} size={24} readOnly={item.readOnly} />
        {#if statusDot}
          <span
            class="status-dot"
            data-color={statusDot.color}
            role="status"
            aria-label={labels[statusDot.labelKey]}
            title={labels[statusDot.labelKey]}
          ></span>
        {/if}
      </span>
      <span class="row-title">{item.title}</span>
      <span class="row-time">{formatTime(item.updatedAt)}</span>
    </button>
  {/if}
</div>

{#if menuOpen}
  <Portal to="body">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="row-menu-backdrop"
      role="presentation"
      aria-hidden="true"
      onclick={() => (menuOpen = false)}
      oncontextmenu={(event) => { event.preventDefault(); menuOpen = false; }}
    ></div>
    <div class="row-menu" role="menu" tabindex="-1" bind:this={menuEl} use:autofocus onkeydown={onMenuKeydown} style={`top:${menuPos.top}px; left:${menuPos.left}px;`}>
      {#if confirmingDelete}
        <p class="row-menu-prompt">{labels.deletePrompt}</p>
        <div class="row-menu-confirm">
          <button type="button" class="row-menu-btn-plain" onclick={() => (confirmingDelete = false)}>{labels.cancel}</button>
          <button type="button" class="row-menu-btn-danger" onclick={confirmDelete}>{labels.delete}</button>
        </div>
      {:else}
        {#if canRename}
          <button type="button" class="row-menu-item" role="menuitem" onclick={startRename}>
            <Pen size={14} aria-hidden="true" />
            <span>{labels.rename}</span>
          </button>
        {/if}
        {#if onCopyPath}
          <button type="button" class="row-menu-item" role="menuitem" onclick={handleCopyPath}>
            <Copy size={14} aria-hidden="true" />
            <span>{labels.copyPath ?? "复制 session 路径"}</span>
          </button>
        {/if}
        {#if onRevealInFinder}
          <button type="button" class="row-menu-item" role="menuitem" onclick={handleRevealInFinder}>
            <FolderOpen size={14} aria-hidden="true" />
            <span>{labels.revealInFinder ?? "从 Finder 打开"}</span>
          </button>
        {/if}
        {#if canDelete}
          {#if canRename || onCopyPath || onRevealInFinder}
            <div class="row-menu-separator" role="separator"></div>
          {/if}
          <button type="button" class="row-menu-item danger" role="menuitem" onclick={askDelete}>
            <Trash size={14} aria-hidden="true" />
            <span>{labels.delete}</span>
          </button>
        {/if}
      {/if}
    </div>
  </Portal>
{/if}

<style>
  .conversation-row {
    --conversation-row-overlay: var(--sidebar-bg, #fafafa);
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    min-height: 32px;
    padding: 4px 8px;
    border: none;
    background: transparent;
    border-radius: var(--rounded-sm, 6px);
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: background var(--duration-instant) var(--ease-standard);
  }
  .conversation-row.forked { padding-left: 16px; }
  .row-branch {
    position: absolute;
    left: 3px;
    color: var(--label-tertiary, #8f8f8f);
    font-size: var(--fs-meta);
    line-height: 1;
  }
  .conversation-row:hover,
  .conversation-row:focus-within,
  .conversation-row.menu-open {
    --conversation-row-overlay: var(--fill, rgba(0, 0, 0, 0.05));
    background: var(--fill, rgba(0, 0, 0, 0.05));
  }
  .conversation-row.active {
    --conversation-row-overlay: var(--accent-soft, #f0f7ff);
    background: var(--accent-soft, #f0f7ff);
  }
  .conversation-row.active .row-title {
    color: var(--accent, #006bff);
    font-weight: 500;
  }
  .conversation-row[data-read-only="true"] {
    cursor: default;
  }

  /* The row's main clickable surface. A real button replaces the old
     role="button" div so the nested menu button is valid markup. */
  .row-open {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: inherit;
  }
  .conversation-row[data-read-only="true"] .row-open {
    cursor: default;
  }

  /* Avatar carries the status dot as a corner badge, so it never eats into the
     title's horizontal space. */
  .row-avatar {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    line-height: 0;
  }
  .row-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--fs-label);
    line-height: var(--lh-label);
    color: var(--label-primary, #171717);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-time {
    flex: 0 0 auto;
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    color: var(--label-tertiary, #8f8f8f);
    white-space: nowrap;
  }
  .row-rename-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--accent, #006bff);
    border-radius: var(--rounded-sm, 6px);
    background: var(--card-bg);
    color: var(--label-primary, #171717);
    font-size: var(--fs-label);
  }
  .row-rename-input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .status-dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 9px;
    height: 9px;
    border-radius: 9999px;
    /* ring separates the dot from the avatar; matches the sidebar surface */
    box-shadow: 0 0 0 2px var(--sidebar-bg, #fafafa);
  }
  .status-dot[data-color="running"] {
    background: var(--accent, #006bff);
    animation: bot-status-pulse 1.6s infinite;
  }
  .status-dot[data-color="waiting"] { background: var(--warning, #ffae00); }
  .status-dot[data-color="completed"] { background: var(--online); }
  .status-dot[data-color="failed"] { background: var(--danger); }
  @keyframes bot-status-pulse {
    0% { box-shadow: 0 0 0 2px var(--sidebar-bg, #fafafa), 0 0 0 0 color-mix(in srgb, var(--accent, #006bff) 50%, transparent); }
    70% { box-shadow: 0 0 0 2px var(--sidebar-bg, #fafafa), 0 0 0 5px transparent; }
    100% { box-shadow: 0 0 0 2px var(--sidebar-bg, #fafafa), 0 0 0 0 transparent; }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-dot[data-color="running"] { animation: none; }
  }

  .row-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 39;
    background: transparent;
  }

  .row-menu {
    position: fixed;
    z-index: 40;
    min-width: 170px;
    padding: 4px;
    border: 1px solid var(--separator, rgba(0, 0, 0, 0.08));
    border-radius: var(--rounded-md, 12px);
    background: var(--glass-popover-bg, var(--card-bg));
    backdrop-filter: var(--glass-popover-filter, blur(24px) saturate(180%));
    -webkit-backdrop-filter: var(--glass-popover-filter, blur(24px) saturate(180%));
    box-shadow: var(--glass-chip-shadow, var(--popover-shadow)), var(--glass-edge, 0 0 #0000);
    transform-origin: top right;
    animation: popover-in 120ms var(--ease-spring);
  }
  .row-menu-separator {
    height: 1px;
    margin: 4px -4px;
    background: var(--separator, rgba(0, 0, 0, 0.08));
  }
  .row-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border: none;
    border-radius: var(--rounded-sm, 6px);
    background: transparent;
    color: var(--label-primary, #171717);
    font-size: var(--fs-label);
    text-align: left;
    cursor: pointer;
  }
  .row-menu-item :global(svg) { opacity: 0.8; }
  .row-menu-item:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .row-menu-item.danger { color: var(--danger); }
  .row-menu-item.danger:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }

  /* Inline delete confirmation (replaces the native window.confirm). */
  .row-menu-prompt {
    margin: 0;
    padding: 6px 8px 4px;
    font-size: var(--fs-label);
    line-height: var(--lh-label);
    color: var(--label-secondary, #666);
  }
  .row-menu-confirm {
    display: flex;
    gap: 6px;
    padding: 2px 4px 2px;
  }
  .row-menu-btn-plain,
  .row-menu-btn-danger {
    flex: 1 1 0;
    padding: 6px 8px;
    border-radius: var(--rounded-sm, 6px);
    border: 1px solid var(--separator, rgba(0, 0, 0, 0.08));
    font-size: var(--fs-label);
    font-weight: 500;
    cursor: pointer;
  }
  .row-menu-btn-plain {
    background: transparent;
    color: var(--label-primary, #171717);
  }
  .row-menu-btn-plain:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .row-menu-btn-danger {
    border-color: transparent;
    background: var(--danger);
    color: var(--on-accent);
  }
  .row-menu-btn-danger:hover { background: var(--danger-hover); }
</style>
