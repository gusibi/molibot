<script lang="ts">
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import Plus from "reicon-svelte/icons/Plus";
  import { CHANNEL_ICONS, CHANNEL_LOGOS } from "./activityIcons";
  import ConversationRow from "./ConversationRow.svelte";
  import BotAvatar from "./BotAvatar.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";
  import { sessionRuntimeKey } from "./sessionStatusDot.js";

  export interface ChannelDescriptor {
    id: "web" | "telegram" | "feishu" | "qq" | "weixin";
    icon: string;
    name: string;
    configured: boolean;
  }

  let {
    channel,
    expanded,
    items = [],
    hasMore = false,
    activeSessionId = "",
    statusDots = new Map<string, SessionStatusDot>(),
    loading = false,
    loadingMore = false,
    labels,
    formatTime,
    onToggle,
    onNewSession = null,
    onSelect,
    onMore,
    onConfigure,
    onRenameItem,
    onDeleteItem
  }: {
    channel: ChannelDescriptor;
    expanded: boolean;
    items?: DesktopConversationItem[];
    hasMore?: boolean;
    activeSessionId?: string;
    statusDots?: Map<string, SessionStatusDot>;
    loading?: boolean;
    loadingMore?: boolean;
    labels: {
      running: string;
      waitingApproval: string;
      completed: string;
      failed: string;
      more: string;
      emptyWeb: string;
      emptyExternal: string;
      notConfigured: string;
      goToSettings: string;
      menu: string;
      rename: string;
      delete: string;
      renamePlaceholder: string;
      deletePrompt: string;
      cancel: string;
      forkedConversation: string;
      newChat: string;
      loading?: string;
    };
    formatTime: (iso: string) => string;
    onToggle: () => void;
    onNewSession?: (() => void) | null;
    onSelect: (item: DesktopConversationItem) => void;
    onMore: () => void;
    onConfigure: () => void;
    onRenameItem: (item: DesktopConversationItem, title: string) => void;
    onDeleteItem: (item: DesktopConversationItem) => void;
  } = $props();

  function dotFor(item: DesktopConversationItem): SessionStatusDot | null {
    if (item.readOnly) return null;
    return statusDots.get(sessionRuntimeKey(item.botId, item.sessionId)) ?? null;
  }

  let ChannelIcon = $derived(CHANNEL_ICONS[channel.icon] ?? CHANNEL_ICONS.globe);
  let channelLogo = $derived(CHANNEL_LOGOS[channel.id]);
</script>

<section class="channel-accordion" data-expanded={expanded}>
  <div class="channel-accordion-head">
    <button
      type="button"
      class="channel-accordion-header"
      aria-expanded={expanded}
      onclick={onToggle}
    >
      {#if channelLogo}
        <img class="channel-logo" src={channelLogo} alt="" width="16" height="16" aria-hidden="true" />
      {:else}
        <i aria-hidden="true"><ChannelIcon size={16} /></i>
      {/if}
      <span class="channel-accordion-name">{channel.name}</span>
    </button>
    {#if onNewSession}
      <button
        type="button"
        class="channel-new-session"
        aria-label={labels.newChat}
        title={labels.newChat}
        onclick={onNewSession}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    {/if}
    <button
      type="button"
      class="channel-caret-button"
      aria-label={channel.name}
      aria-expanded={expanded}
      onclick={onToggle}
    >
      <i class={expanded ? "chevron open" : "chevron"} aria-hidden="true"><CaretRight size={12} /></i>
    </button>
  </div>

  {#if expanded}
    <div class="channel-accordion-body">
      {#if loading}
        <p class="channel-state" aria-busy="true">{labels.loading ?? "…"}</p>
      {:else if !channel.configured}
        <p class="channel-state">{labels.notConfigured}</p>
        <button type="button" class="channel-configure" onclick={onConfigure}>{labels.goToSettings}</button>
      {:else if items.length === 0}
        <p class="channel-state">{channel.id === "web" ? labels.emptyWeb : labels.emptyExternal}</p>
      {:else}
        <ul class="channel-items">
          {#each items as item (item.sessionId)}
            <li>
              <ConversationRow
                {item}
                active={item.sessionId === activeSessionId}
                statusDot={dotFor(item)}
                {formatTime}
                labels={{ running: labels.running, waitingApproval: labels.waitingApproval, completed: labels.completed, failed: labels.failed, menu: labels.menu, rename: labels.rename, delete: labels.delete, placeholder: labels.renamePlaceholder, deletePrompt: labels.deletePrompt, cancel: labels.cancel, forkedConversation: labels.forkedConversation }}
                onSelect={() => onSelect(item)}
                onRename={(title) => onRenameItem(item, title)}
                onDelete={() => onDeleteItem(item)}
              />
            </li>
          {/each}
        </ul>
        {#if hasMore}
          <button type="button" class="channel-more" disabled={loadingMore} aria-busy={loadingMore} onclick={onMore}>{loadingMore ? `${labels.more}…` : labels.more}</button>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .channel-accordion { margin-top: 2px; padding-left: 8px; }
  .channel-accordion:first-child { margin-top: 0; }
  .channel-accordion-head {
    display: flex;
    align-items: center;
    border-radius: var(--rounded-sm, 6px);
    transition: background var(--duration-instant) var(--ease-standard);
  }
  .channel-accordion-head:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .channel-accordion-header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
    padding: 6px 8px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--label-primary, #171717);
    text-align: left;
    font-size: var(--fs-label);
    font-weight: 500;
    letter-spacing: 0;
  }
  .channel-accordion-header i:first-child { font-size: var(--icon-md); color: var(--label-secondary); }
  .channel-logo { display: block; flex: none; width: var(--icon-md); height: var(--icon-md); object-fit: contain; }
  .channel-accordion-name { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .channel-new-session,
  .channel-caret-button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 0;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--rounded-sm, 6px);
    background: transparent;
    color: var(--label-tertiary, #8f8f8f);
    cursor: pointer;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition: width var(--duration-fast) var(--ease-standard), opacity var(--duration-instant) var(--ease-standard), background var(--duration-instant) var(--ease-standard), color var(--duration-instant) var(--ease-standard);
  }
  .channel-accordion-head:hover .channel-new-session,
  .channel-accordion-head:hover .channel-caret-button,
  .channel-accordion-head:focus-within .channel-new-session,
  .channel-accordion-head:focus-within .channel-caret-button { width: 26px; opacity: 1; pointer-events: auto; }
  .channel-new-session:hover,
  .channel-caret-button:hover { background: var(--fill-hover); color: var(--label-primary); }
  .channel-new-session:focus-visible,
  .channel-caret-button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent); color: var(--label-primary); }
  .channel-new-session :global(svg) { width: var(--icon-sm); height: var(--icon-sm); }
  .chevron { flex: none; font-size: var(--icon-xs); color: inherit; transition: transform var(--duration-instant) var(--ease-standard); }
  .chevron.open { transform: rotate(90deg); }
  .channel-accordion-body { padding: 1px 0 4px; }
  .channel-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .channel-state { padding: 8px; font-size: var(--fs-label); color: var(--label-tertiary, #8f8f8f); margin: 0; }
  .channel-configure, .channel-more {
    border: none;
    background: transparent;
    color: var(--accent, #006bff);
    cursor: pointer;
    font-size: var(--fs-label);
    padding: 6px 8px;
    width: 100%;
    text-align: left;
  }
  .channel-configure:hover, .channel-more:hover { text-decoration: underline; }
  .channel-more:disabled { cursor: default; opacity: .55; text-decoration: none; }
</style>
