<script lang="ts">
  import { tick } from "svelte";
  import BotAvatar from "./BotAvatar.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";

  type ConversationRowItem = Pick<DesktopConversationItem, "title" | "updatedAt" | "readOnly" | "botId" | "botName" | "botDeleted">;

  let {
    item,
    active = false,
    statusDot = null,
    formatTime,
    labels,
    onSelect,
    onRename,
    onDelete
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
      placeholder?: string;
      deletePrompt?: string;
      cancel?: string;
    };
    onSelect: () => void;
    onRename?: (title: string) => void;
    onDelete?: () => void;
  } = $props();

  // The row menu (rename/delete) is only offered for editable Web conversations
  // when the host wires up handlers — the browser dialog reuses the row for
  // selection only and passes none.
  const canManage = $derived(!item.readOnly && Boolean(onRename) && Boolean(onDelete));

  let menuOpen = $state(false);
  let menuPos = $state({ top: 0, left: 0 });
  let menuBtn: HTMLButtonElement | null = $state(null);
  let confirmingDelete = $state(false);

  let editing = $state(false);
  let draftTitle = $state("");
  let inputEl: HTMLInputElement | null = $state(null);

  const MENU_WIDTH = 148;

  function openMenu(event: MouseEvent): void {
    event.stopPropagation();
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    const rect = (menuBtn ?? (event.currentTarget as HTMLElement)).getBoundingClientRect();
    menuPos = {
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - MENU_WIDTH)
    };
    confirmingDelete = false;
    menuOpen = true;
  }

  function onWindowPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".row-menu") || target?.closest(".row-menu-btn")) return;
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

<div
  class="conversation-row"
  class:active
  class:menu-open={menuOpen}
  data-read-only={item.readOnly}
  role="button"
  tabindex="0"
  title={item.title}
  onclick={onRowClick}
  onkeydown={(event) => {
    if (editing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }}
>
  <span class="row-avatar">
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
  {#if editing}
    <input
      class="row-rename-input"
      bind:this={inputEl}
      bind:value={draftTitle}
      placeholder={labels.placeholder}
      onclick={(e) => e.stopPropagation()}
      onkeydown={onEditKeydown}
      onblur={commitRename}
    />
  {:else}
    <span class="row-title">{item.title}</span>
    <span class="row-time">{formatTime(item.updatedAt)}</span>
    {#if canManage}
      <button
        type="button"
        class="row-menu-btn"
        bind:this={menuBtn}
        aria-label={labels.menu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={labels.menu}
        onclick={openMenu}
      >
        <i class="ph ph-dots-three" aria-hidden="true"></i>
      </button>
    {/if}
  {/if}
</div>

{#if menuOpen}
  <div class="row-menu" role="menu" style={`top:${menuPos.top}px; left:${menuPos.left}px;`}>
    {#if confirmingDelete}
      <p class="row-menu-prompt">{labels.deletePrompt}</p>
      <div class="row-menu-confirm">
        <button type="button" class="row-menu-btn-plain" onclick={() => (confirmingDelete = false)}>{labels.cancel}</button>
        <button type="button" class="row-menu-btn-danger" onclick={confirmDelete}>{labels.delete}</button>
      </div>
    {:else}
      <button type="button" class="row-menu-item" role="menuitem" onclick={startRename}>
        <i class="ph ph-pencil-simple" aria-hidden="true"></i>
        <span>{labels.rename}</span>
      </button>
      <button type="button" class="row-menu-item danger" role="menuitem" onclick={askDelete}>
        <i class="ph ph-trash" aria-hidden="true"></i>
        <span>{labels.delete}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .conversation-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: var(--rounded-sm, 6px);
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: background 0.12s ease;
  }
  .conversation-row:hover,
  .conversation-row:focus-visible,
  .conversation-row.menu-open {
    background: var(--fill, rgba(0, 0, 0, 0.05));
  }
  .conversation-row.active {
    background: var(--accent-soft, #f0f7ff);
  }
  .conversation-row.active .row-title {
    color: var(--accent, #006bff);
    font-weight: 500;
  }
  .conversation-row[data-read-only="true"] {
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
    font-size: 13px;
    line-height: 1.35;
    color: var(--label-primary, #171717);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-time {
    flex: 0 0 auto;
    margin-left: auto;
    font-size: 11px;
    color: var(--label-tertiary, #8f8f8f);
    white-space: nowrap;
  }
  /* On hover / active, the timestamp yields to the ellipsis menu in the same slot.
     Read-only rows have no menu, so they keep showing the time. */
  .conversation-row:not([data-read-only="true"]):hover .row-time,
  .conversation-row:not([data-read-only="true"]):focus-within .row-time,
  .conversation-row.menu-open .row-time {
    display: none;
  }
  .row-rename-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--accent, #006bff);
    border-radius: var(--rounded-sm, 6px);
    background: var(--panel-bg, #fff);
    color: var(--label-primary, #171717);
    font-size: 13px;
    outline: none;
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
  .status-dot[data-color="completed"] { background: var(--success, #28a948); }
  .status-dot[data-color="failed"] { background: var(--danger, #e4106e); }
  @keyframes bot-status-pulse {
    0% { box-shadow: 0 0 0 2px var(--sidebar-bg, #fafafa), 0 0 0 0 color-mix(in srgb, var(--accent, #006bff) 50%, transparent); }
    70% { box-shadow: 0 0 0 2px var(--sidebar-bg, #fafafa), 0 0 0 5px transparent; }
    100% { box-shadow: 0 0 0 2px var(--sidebar-bg, #fafafa), 0 0 0 0 transparent; }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-dot[data-color="running"] { animation: none; }
  }

  /* Ellipsis menu trigger — hidden until row hover / active / menu open, and
     sits in the timestamp's right-hand slot. */
  .row-menu-btn {
    display: none;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    margin-left: auto;
    width: 22px;
    height: 22px;
    margin-right: -2px;
    padding: 0;
    border: none;
    border-radius: var(--rounded-sm, 6px);
    background: transparent;
    color: var(--label-secondary, #666);
    cursor: pointer;
    transition: background 0.12s ease;
  }
  .row-menu-btn i { font-size: 16px; }
  .conversation-row:hover .row-menu-btn,
  .conversation-row:focus-within .row-menu-btn,
  .conversation-row.menu-open .row-menu-btn {
    display: flex;
  }
  .row-menu-btn:hover { background: var(--fill-hover, rgba(0, 0, 0, 0.08)); }

  .row-menu {
    position: fixed;
    z-index: 40;
    min-width: 148px;
    padding: 4px;
    border: 1px solid var(--separator, rgba(0, 0, 0, 0.08));
    border-radius: var(--rounded-md, 12px);
    background: var(--panel-bg, #fff);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14), 0 2px 6px rgba(0, 0, 0, 0.08);
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
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .row-menu-item i { font-size: 15px; opacity: 0.8; }
  .row-menu-item:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .row-menu-item.danger { color: var(--danger, #e4106e); }
  .row-menu-item.danger:hover { background: color-mix(in srgb, var(--danger, #e4106e) 10%, transparent); }

  /* Inline delete confirmation (replaces the native window.confirm). */
  .row-menu-prompt {
    margin: 0;
    padding: 6px 8px 4px;
    font-size: 12px;
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
    font-size: 12px;
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
    background: var(--danger, #e4106e);
    color: #fff;
  }
  .row-menu-btn-danger:hover { background: color-mix(in srgb, var(--danger, #e4106e) 88%, #000); }
</style>
