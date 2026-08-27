<script lang="ts">
  import Dialog from "../components/ui/Dialog.svelte";
  import { searchDesktopConversations } from "../api.js";
  import type {
    DesktopConversationSearchGroup,
    DesktopConversationSearchItem,
    DesktopConversationSearchScope,
    DesktopConversationSearchSource
  } from "@molibot/desktop-contract";

  let {
    endpoint,
    open = false,
    labels,
    formatTime,
    onSelect,
    onClose
  }: {
    endpoint: string;
    open?: boolean;
    labels: {
      search: string;
      searchEmpty: string;
      loading: string;
      loadMore: string;
      empty: string;
      close: string;
      all: string;
      web: string;
      project: string;
      channels: string;
      allChannels: string;
      scopeFilter: string;
      telegram: string;
      feishu: string;
      qq: string;
      weixin: string;
      unknownBot: string;
    };
    formatTime: (iso: string) => string;
    onSelect: (item: DesktopConversationSearchItem) => void;
    onClose: () => void;
  } = $props();

  const PRIMARY_SCOPES: DesktopConversationSearchScope[] = ["all", "web", "project", "channels"];
  const CHANNEL_SCOPES: DesktopConversationSearchScope[] = ["channels", "telegram", "feishu", "qq", "weixin"];
  const SOURCE_ICONS: Record<DesktopConversationSearchSource, string> = {
    web: "browser",
    project: "folder-simple",
    telegram: "telegram-logo",
    feishu: "bird",
    qq: "linux-logo",
    weixin: "wechat-logo"
  };

  let query = $state("");
  let scope = $state<DesktopConversationSearchScope>("all");
  let groups = $state<DesktopConversationSearchGroup[]>([]);
  let loading = $state(false);
  let loadingMore = $state<Record<string, boolean>>({});
  let error = $state("");
  let opened = false;
  let completing = false;
  let generation = 0;
  let searchInput = $state<HTMLInputElement>();

  const scopeLabel = (value: DesktopConversationSearchScope | DesktopConversationSearchSource): string => {
    if (value === "all") return labels.all;
    if (value === "channels") return labels.allChannels;
    return labels[value];
  };

  function requestClose(): void {
    if (completing) return;
    completing = true;
    onClose();
  }

  function handleOpenChange(next: boolean): void {
    if (!next) requestClose();
  }

  async function loadResults(q: string, nextScope: DesktopConversationSearchScope): Promise<void> {
    const requestGeneration = ++generation;
    loading = true;
    error = "";
    try {
      const response = await searchDesktopConversations(endpoint, { scope: nextScope, query: q, limit: 10 });
      if (requestGeneration === generation) groups = response.groups;
    } catch (cause) {
      if (requestGeneration === generation) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (requestGeneration === generation) loading = false;
    }
  }

  $effect(() => {
    if (!open) {
      opened = false;
      completing = false;
      return;
    }
    const q = query;
    const nextScope = scope;
    if (!opened) {
      opened = true;
      void loadResults(q, nextScope);
      return;
    }
    const timer = window.setTimeout(() => void loadResults(q, nextScope), 250);
    return () => window.clearTimeout(timer);
  });

  async function loadMore(group: DesktopConversationSearchGroup): Promise<void> {
    if (!group.nextCursor || loadingMore[group.source]) return;
    const requestedQuery = query;
    const requestedScope = scope;
    loadingMore = { ...loadingMore, [group.source]: true };
    try {
      const response = await searchDesktopConversations(endpoint, {
        scope: group.source,
        query: requestedQuery,
        limit: 10,
        cursor: group.nextCursor
      });
      if (query !== requestedQuery || scope !== requestedScope) return;
      const next = response.groups[0];
      if (!next) return;
      const seen = new Set(group.items.map((item) => item.sessionId));
      const appended = next.items.filter((item) => !seen.has(item.sessionId));
      groups = groups.map((item) => item.source === group.source
        ? { ...item, items: [...item.items, ...appended], nextCursor: next.nextCursor, hasMore: next.hasMore }
        : item);
    } catch (cause) {
      if (query === requestedQuery && scope === requestedScope) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      loadingMore = { ...loadingMore, [group.source]: false };
    }
  }

  function pick(item: DesktopConversationSearchItem): void {
    if (completing) return;
    completing = true;
    onSelect(item);
  }

  function focusSearch(event: Event): void {
    event.preventDefault();
    searchInput?.focus();
  }

  function selectScope(value: DesktopConversationSearchScope): void {
    if (scope === value) return;
    scope = value;
    groups = [];
    loading = true;
  }

  let totalItems = $derived(groups.reduce((sum, group) => sum + group.items.length, 0));
  let channelScopeActive = $derived(scope === "channels" || CHANNEL_SCOPES.includes(scope));
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

  <div class="browser-scope-bar" role="group" aria-label={labels.scopeFilter}>
    {#each PRIMARY_SCOPES as value (value)}
      <button
        type="button"
        class:active={value === "channels" ? channelScopeActive : scope === value}
        aria-pressed={value === "channels" ? channelScopeActive : scope === value}
        onclick={() => selectScope(value)}
      >{value === "channels" ? labels.channels : scopeLabel(value)}</button>
    {/each}
  </div>
  {#if channelScopeActive}
    <div class="browser-channel-scopes" role="group" aria-label={labels.allChannels}>
      {#each CHANNEL_SCOPES as value (value)}
        <button type="button" class:active={scope === value} aria-pressed={scope === value} onclick={() => selectScope(value)}>
          {scopeLabel(value)}
        </button>
      {/each}
    </div>
  {/if}

  <div class="browser-body">
    <h2 id="conversation-browser-title" class="sr-only">{labels.search}</h2>
    {#if loading && groups.length === 0}
      <p class="browser-state">{labels.loading}</p>
    {:else if error}
      <p class="browser-state browser-error">{error}</p>
    {:else if groups.length === 0 || totalItems === 0}
      <p class="browser-state">{query ? labels.searchEmpty : labels.empty}</p>
    {:else}
      {#each groups as group (group.source)}
        <section class="browser-group">
          <header class="browser-group-header">
            <i class={`ph ph-${SOURCE_ICONS[group.source]}`} aria-hidden="true"></i>
            <span class="browser-group-name">{scopeLabel(group.source)}</span>
            <span class="browser-group-count">{group.total}</span>
          </header>
          <div class="browser-result-list">
            {#each group.items as item (item.sessionId)}
              <button type="button" class="browser-result" title={item.title} onclick={() => pick(item)}>
                <span class="browser-result-icon"><i class={`ph ph-${SOURCE_ICONS[item.source]}`} aria-hidden="true"></i></span>
                <span class="browser-result-copy">
                  <span class="browser-result-title">{item.title}</span>
                  <span class="browser-result-meta">
                    <span>{item.contextName || labels.unknownBot}</span><span aria-hidden="true">·</span><time>{formatTime(item.updatedAt)}</time>
                  </span>
                  {#if item.latestMessagePreview}<span class="browser-result-preview">{item.latestMessagePreview}</span>{/if}
                </span>
              </button>
            {/each}
          </div>
          {#if group.hasMore}
            <button type="button" class="browser-load-more" disabled={loadingMore[group.source]} onclick={() => loadMore(group)}>
              {loadingMore[group.source] ? labels.loading : labels.loadMore}
            </button>
          {/if}
        </section>
      {/each}
    {/if}
  </div>
</Dialog>
