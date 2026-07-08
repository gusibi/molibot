<script lang="ts">
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
    labels,
    formatTime,
    onToggle,
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
    };
    formatTime: (iso: string) => string;
    onToggle: () => void;
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
</script>

<section class="channel-accordion" data-expanded={expanded}>
  <button
    type="button"
    class="channel-accordion-header"
    aria-expanded={expanded}
    onclick={onToggle}
  >
    <i class={`ph-fill ph-${channel.icon}`} aria-hidden="true"></i>
    <span class="channel-accordion-name">{channel.name}</span>
    <i class="ph ph-caret-right chevron" class:open={expanded} aria-hidden="true"></i>
  </button>

  {#if expanded}
    <div class="channel-accordion-body">
      {#if loading}
        <p class="channel-state">…</p>
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
                labels={{ running: labels.running, waitingApproval: labels.waitingApproval, completed: labels.completed, failed: labels.failed, menu: labels.menu, rename: labels.rename, delete: labels.delete, placeholder: labels.renamePlaceholder, deletePrompt: labels.deletePrompt, cancel: labels.cancel }}
                onSelect={() => onSelect(item)}
                onRename={(title) => onRenameItem(item, title)}
                onDelete={() => onDeleteItem(item)}
              />
            </li>
          {/each}
        </ul>
        {#if hasMore}
          <button type="button" class="channel-more" onclick={onMore}>{labels.more}</button>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .channel-accordion { margin-top: 2px; }
  .channel-accordion:first-child { margin-top: 0; }
  .channel-accordion-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--rounded-sm, 6px);
    background: transparent;
    cursor: pointer;
    color: var(--label-secondary, #666);
    text-align: left;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.01em;
    transition: background 0.12s ease;
  }
  .channel-accordion-header:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .channel-accordion-header i:first-child { font-size: 15px; opacity: 0.7; }
  .channel-accordion-name { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chevron { font-size: 11px; color: var(--label-tertiary, #8f8f8f); transition: transform 0.12s ease; flex: 0 0 auto; }
  .chevron.open { transform: rotate(90deg); }
  .channel-accordion-body { padding: 1px 0 4px; }
  .channel-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .channel-state { padding: 8px; font-size: 12px; color: var(--label-tertiary, #8f8f8f); margin: 0; }
  .channel-configure, .channel-more {
    border: none;
    background: transparent;
    color: var(--accent, #006bff);
    cursor: pointer;
    font-size: 12px;
    padding: 6px 8px;
    width: 100%;
    text-align: left;
  }
  .channel-configure:hover, .channel-more:hover { text-decoration: underline; }
</style>
