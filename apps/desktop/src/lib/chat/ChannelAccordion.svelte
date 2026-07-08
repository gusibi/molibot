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
    onStop,
    onMore,
    onConfigure
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
    };
    formatTime: (iso: string) => string;
    onToggle: () => void;
    onSelect: (item: DesktopConversationItem) => void;
    onStop: (item: DesktopConversationItem) => void;
    onMore: () => void;
    onConfigure: () => void;
  } = $props();

  function dotFor(item: DesktopConversationItem): SessionStatusDot | null {
    if (item.readOnly) return null;
    return statusDots.get(sessionRuntimeKey(item.botId, item.sessionId)) ?? null;
  }

  function stopFor(item: DesktopConversationItem): (() => void) | undefined {
    return item.readOnly ? undefined : () => onStop(item);
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
                labels={{ running: labels.running, waitingApproval: labels.waitingApproval, completed: labels.completed, failed: labels.failed }}
                onSelect={() => onSelect(item)}
                onStop={stopFor(item)}
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
  .channel-accordion { border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.06)); }
  .channel-accordion-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: inherit;
    text-align: left;
    font-size: 13px;
    font-weight: 500;
  }
  .channel-accordion-header:hover { background: var(--fill-hover, rgba(0, 0, 0, 0.04)); }
  .channel-accordion-header i:first-child { font-size: 16px; opacity: 0.85; }
  .channel-accordion-name { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chevron { font-size: 12px; opacity: 0.5; transition: transform 0.12s ease; flex: 0 0 auto; }
  .chevron.open { transform: rotate(90deg); }
  .channel-accordion-body { padding: 2px 6px 8px; }
  .channel-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .channel-state { padding: 10px 8px; font-size: 12px; opacity: 0.55; margin: 0; }
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
