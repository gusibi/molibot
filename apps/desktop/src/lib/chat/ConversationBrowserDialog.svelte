<script lang="ts">
  import BotAvatar from "./BotAvatar.svelte";
  import ConversationRow from "./ConversationRow.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
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
      close: string;
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
  let completing = false;
  let searchInput = $state<HTMLInputElement>();

  function requestClose(): void {
    if (completing) return;
    completing = true;
    onClose();
  }

  function handleOpenChange(next: boolean): void {
    if (!next) requestClose();
  }

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

  $effect(() => {
    if (!open) {
      opened = false;
      completing = false;
      return;
    }
    const q = query;
    if (!opened) {
      opened = true;
      void loadGroups(q);
      return;
    }
    const timer = window.setTimeout(() => void loadGroups(q), 250);
    return () => window.clearTimeout(timer);
  });

  async function loadMore(botId: string): Promise<void> {
    const group = groups.find((item) => item.botId === botId);
    if (!group || !group.nextCursor) return;
    loadingMore = { ...loadingMore, [botId]: true };
    try {
      const res = await listDesktopConversations(endpoint, { channel, botId, cursor: group.nextCursor });
      groups = groups.map((item) =>
        item.botId === botId
          ? { ...item, items: [...item.items, ...res.items], nextCursor: res.nextCursor, hasMore: res.hasMore }
          : item
      );
    } finally {
      loadingMore = { ...loadingMore, [botId]: false };
    }
  }

  function pick(item: DesktopConversationItem): void {
    if (completing) return;
    completing = true;
    onSelect(item);
  }

  function focusSearch(event: Event): void {
    event.preventDefault();
    searchInput?.focus();
  }

  let totalItems = $derived(groups.reduce((sum, group) => sum + group.items.length, 0));
</script>

<Dialog
  {open}
  contentClass="conversation-browser-dialog"
  labelledBy="conversation-browser-title"
  onOpenChange={handleOpenChange}
  onOpenAutoFocus={focusSearch}
>
  <header class="browser-header">
    <div class="browser-search">
      <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
      <input bind:this={searchInput} bind:value={query} placeholder={labels.search} aria-label={labels.search} />
      {#if query}
        <button type="button" aria-label={labels.search} onclick={() => (query = "")}>
          <i class="ph-fill ph-x-circle" aria-hidden="true"></i>
        </button>
      {/if}
    </div>
    <button type="button" class="browser-close" aria-label={labels.close} onclick={requestClose}>
      <i class="ph ph-x" aria-hidden="true"></i>
    </button>
  </header>

  <div class="browser-body">
    <h2 id="conversation-browser-title" class="sr-only">{labels.search}</h2>
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
            <span class="browser-group-name">{group.botDeleted ? labels.deletedBot : (group.botName || labels.unknownBot)}</span>
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
            <button type="button" class="browser-load-more" disabled={loadingMore[group.botId]} onclick={() => loadMore(group.botId)}>
              {loadingMore[group.botId] ? labels.loading : labels.loadMore}
            </button>
          {/if}
        </section>
      {/each}
    {/if}
  </div>
</Dialog>
