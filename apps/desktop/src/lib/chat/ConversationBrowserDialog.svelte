<script lang="ts">
  import BotAvatar from "./BotAvatar.svelte";
  import ConversationRow from "./ConversationRow.svelte";
  import { listDesktopConversationGroups, listDesktopConversations } from "../api.js";
  import type {
    DesktopConversationBotGroup,
    DesktopConversationChannel,
    DesktopConversationItem
  } from "@molibot/desktop-contract";

  let {
    endpoint,
    channel,
    open = false,
    labels,
    formatTime,
    onSelect,
    onClose
  }: {
    endpoint: string;
    channel: DesktopConversationChannel;
    open?: boolean;
    labels: {
      search: string;
      searchEmpty: string;
      loading: string;
      loadMore: string;
      empty: string;
      deletedBot: string;
      unknownBot: string;
    };
    formatTime: (iso: string) => string;
    onSelect: (item: DesktopConversationItem) => void;
    onClose: () => void;
  } = $props();

  let query = $state("");
  let groups = $state<DesktopConversationBotGroup[]>([]);
  let loading = $state(false);
  let loadingMore = $state<Record<string, boolean>>({});
  let error = $state("");
  let opened = false;

  async function loadGroups(q: string): Promise<void> {
    loading = true;
    error = "";
    try {
      const res = await listDesktopConversationGroups(endpoint, { channel, query: q });
      groups = res.groups;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  // Load immediately when first opened; debounce (~250ms) subsequent search input.
  $effect(() => {
    if (!open) {
      opened = false;
      return;
    }
    const q = query;
    if (!opened) {
      opened = true;
      void loadGroups(q);
      return;
    }
    const timer = setTimeout(() => void loadGroups(q), 250);
    return () => clearTimeout(timer);
  });

  async function loadMore(botId: string): Promise<void> {
    const group = groups.find((g) => g.botId === botId);
    if (!group || !group.nextCursor) return;
    loadingMore = { ...loadingMore, [botId]: true };
    try {
      const res = await listDesktopConversations(endpoint, { channel, botId, cursor: group.nextCursor });
      groups = groups.map((g) =>
        g.botId === botId
          ? { ...g, items: [...g.items, ...res.items], nextCursor: res.nextCursor, hasMore: res.hasMore }
          : g
      );
    } finally {
      loadingMore = { ...loadingMore, [botId]: false };
    }
  }

  function pick(item: DesktopConversationItem): void {
    onSelect(item);
  }

  let totalItems = $derived(groups.reduce((sum, g) => sum + g.items.length, 0));
</script>

{#if open}
  <div
    class="conversation-browser-overlay"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
  >
    <div class="conversation-browser">
      <header class="browser-header">
        <div class="browser-search">
          <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          <input
            bind:value={query}
            placeholder={labels.search}
            aria-label={labels.search}
          />
          {#if query}
            <button type="button" aria-label={labels.search} onclick={() => (query = "")}>
              <i class="ph-fill ph-x-circle" aria-hidden="true"></i>
            </button>
          {/if}
        </div>
        <button type="button" class="browser-close" aria-label="close" onclick={onClose}>
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </header>

      <div class="browser-body">
        {#if loading && groups.length === 0}
          <p class="browser-state">{labels.loading}</p>
        {:else if error}
          <p class="browser-state browser-error">{error}</p>
        {:else if groups.length === 0 || totalItems === 0}
          <p class="browser-state">{query ? labels.searchEmpty : labels.empty}</p>
        {:else}
          {#each groups as group (group.botId)}
            <section class="browser-group">
              <header class="browser-group-header">
                <BotAvatar botId={group.botId} name={group.botDeleted ? "" : group.botName} size={20} readOnly={group.readOnly} />
                <span class="browser-group-name">
                  {group.botDeleted ? labels.deletedBot : (group.botName || labels.unknownBot)}
                </span>
                <span class="browser-group-count">{group.total}</span>
              </header>
              {#each group.items as item (item.sessionId)}
                <ConversationRow
                  {item}
                  {formatTime}
                  labels={{ running: "", waitingApproval: "", completed: "", failed: "" }}
                  onSelect={() => pick(item)}
                />
              {/each}
              {#if group.hasMore}
                <button
                  type="button"
                  class="browser-load-more"
                  disabled={loadingMore[group.botId]}
                  onclick={() => loadMore(group.botId)}
                >
                  {loadingMore[group.botId] ? labels.loading : labels.loadMore}
                </button>
              {/if}
            </section>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .conversation-browser-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 8vh 16px 16px;
    z-index: 60;
  }
  .conversation-browser {
    width: min(560px, 100%);
    max-height: 76vh;
    display: flex;
    flex-direction: column;
    background: var(--surface, #fff);
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }
  .browser-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  }
  .browser-search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    background: var(--fill, rgba(0, 0, 0, 0.04));
    border-radius: 8px;
    padding: 4px 8px;
  }
  .browser-search input {
    flex: 1 1 auto;
    border: none;
    background: transparent;
    font-size: 13px;
    color: inherit;
    outline: none;
  }
  .browser-search button { border: none; background: transparent; cursor: pointer; color: inherit; }
  .browser-close { border: none; background: transparent; cursor: pointer; color: inherit; padding: 4px; }
  .browser-body { overflow-y: auto; padding: 6px 8px 10px; }
  .browser-state { padding: 24px; text-align: center; opacity: 0.6; font-size: 13px; }
  .browser-error { color: var(--danger, #e4106e); opacity: 1; }
  .browser-group { padding: 4px 0; }
  .browser-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.75;
  }
  .browser-group-name { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .browser-group-count { font-weight: 500; opacity: 0.6; }
  .browser-load-more {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--accent, #006bff);
    cursor: pointer;
    padding: 6px;
    font-size: 12px;
  }
  .browser-load-more:disabled { opacity: 0.5; cursor: default; }
</style>
