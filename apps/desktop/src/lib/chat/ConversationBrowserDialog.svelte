<script lang="ts">
  import { deleteConversationSelection } from "./deleteConversationSelection";
  import Magnifier from "../icons/duotone/components/Magnifier.svelte";
  import X from "reicon-svelte/icons/X";
  import XCircle from "reicon-svelte/icons/XCircle";
  import { CONVERSATION_SOURCE_ICONS as SOURCE_ICONS } from "./activityIcons";
  import AgentConversationRow from "./AgentConversationRow.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import Button from "../components/ui/Button.svelte";
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
    agentId,
    includeArchived = false,
    open = false,
    page = false,
    locale = "zh-CN",
    labels,
    formatTime,
    onSelect,
    onClose,
    onDeleted = () => {},
    onCopyPath,
    onRevealInFinder
  }: {
    endpoint: string;
    agentId?: string;
    includeArchived?: boolean;
    open?: boolean;
    page?: boolean;
    locale?: string;
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
      clearSearch: string;
      telegram: string;
      feishu: string;
      qq: string;
      weixin: string;
      unknownBot: string;
    };
    formatTime: (iso: string) => string;
    onSelect: (item: DesktopConversationSearchItem) => void;
    onClose: () => void;
    onDeleted?: () => void;
    onCopyPath?: (item: DesktopConversationSearchItem) => void | Promise<void>;
    onRevealInFinder?: (item: DesktopConversationSearchItem) => void | Promise<void>;
  } = $props();

  const PRIMARY_SCOPES: DesktopConversationSearchScope[] = ["all", "web", "project", "channels"];
  const visibleScopes = $derived(agentId !== undefined ? PRIMARY_SCOPES.filter(value => value !== "project") : PRIMARY_SCOPES);
  const CHANNEL_SCOPES: DesktopConversationSearchScope[] = ["channels", "telegram", "feishu", "qq", "weixin"];


  let selectedIds = $state<string[]>([]);
  let deleting = $state(false);
  let selecting = $state(false);
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
    selectedIds = [];
    error = "";
    try {
      const response = await searchDesktopConversations(endpoint, { scope: nextScope, query: q, limit: 10, agentId, includeArchived });
      if (requestGeneration === generation) groups = response.groups;
    } catch (cause) {
      if (requestGeneration === generation) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (requestGeneration === generation) loading = false;
    }
  }

  $effect(() => {
    if (!open) {
      generation += 1;
      opened = false;
      completing = false;
      return;
    }
    const q = query;
    const nextScope = scope;
    const selectedAgent = agentId;
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
    const requestGeneration = generation;
    const requestedAgent = agentId;
    const requestedQuery = query;
    const requestedScope = scope;
    loadingMore = { ...loadingMore, [group.source]: true };
    try {
      const response = await searchDesktopConversations(endpoint, {
        agentId, includeArchived,
        scope: agentId !== undefined ? requestedScope : group.source,
        query: requestedQuery,
        limit: 10,
        cursor: group.nextCursor
      });
      if (requestGeneration !== generation || agentId !== requestedAgent || query !== requestedQuery || scope !== requestedScope) return;
      const next = response.groups[0];
      if (!next) return;
      const seen = new Set(group.items.map((item) => item.sessionId));
      const appended = next.items.filter((item) => !seen.has(item.sessionId));
      groups = groups.map((item) => item.source === group.source
        ? { ...item, items: [...item.items, ...appended], nextCursor: next.nextCursor, hasMore: next.hasMore }
        : item);
    } catch (cause) {
      if (requestGeneration === generation && agentId === requestedAgent && query === requestedQuery && scope === requestedScope) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      loadingMore = { ...loadingMore, [group.source]: false };
    }
  }

  async function removeItems(ids: string[]): Promise<void> {
    if (deleting || !ids.length) return;
    const current = generation;
    deleting = true; error = "";
    try {
      const result = await deleteConversationSelection(endpoint, ids);
      if (current === generation) {
        groups = groups.map(group => ({...group, total: group.total - group.items.filter(item => result.deletedIds.includes(item.sessionId)).length, items: group.items.filter(item => !result.deletedIds.includes(item.sessionId))}));
        selectedIds = selectedIds.filter(id => !result.deletedIds.includes(id));
        error = result.error;
      }
      onDeleted();
    } catch (cause) { if (current === generation) error = String(cause); }
    finally { deleting = false; }
  }
  function toggleSelection(id: string): void {
    selectedIds = selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id];
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

{#snippet content()}
  <header class="browser-header">
    <div class="browser-search">
      <Magnifier size={14} aria-hidden="true" />
      <input bind:this={searchInput} bind:value={query} autocomplete="off" spellcheck="false" placeholder={labels.search} aria-label={labels.search} />
      {#if query}
        <button type="button" aria-label={labels.clearSearch} title={labels.clearSearch} onclick={() => (query = "")}>
          <XCircle weight="Filled" size={14} aria-hidden="true" />
        </button>
      {/if}
    </div>
    {#if page}
      <Button onclick={requestClose}><span aria-hidden="true">←</span> {labels.close}</Button>
    {:else}
      <button type="button" class="browser-close" aria-label={labels.close} onclick={requestClose}>
        <X size={16} aria-hidden="true" />
      </button>
    {/if}
  </header>

  <div class="browser-scope-bar" role="group" aria-label={labels.scopeFilter}>
    {#each visibleScopes as value (value)}
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
        {@const GroupIcon = SOURCE_ICONS[group.source]}
        <section class="browser-group">
          <header class="browser-group-header">
            <GroupIcon size={16} aria-hidden="true" />
            <span class="browser-group-name">{agentId !== undefined ? labels.all : scopeLabel(group.source)}</span>
            <span class="browser-group-count">{group.total}</span>
          </header>
          <div class="browser-result-list">
            {#each group.items as item (item.sessionId)}
              {@const ResultIcon = SOURCE_ICONS[item.source]}
              <button type="button" class="browser-result" title={item.title} onclick={() => pick(item)}>
                <span class="browser-result-icon"><ResultIcon size={14} aria-hidden="true" /></span>
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
{/snippet}

{#if page}
  <section class="agent-history-page" aria-label={labels.search}>
    <div class="agent-history-toolbar">
      <div class="browser-search">
        <Magnifier size={18} aria-hidden="true" />
        <input bind:value={query} placeholder={labels.search} aria-label={labels.search} />
        {#if query}<button type="button" aria-label={labels.clearSearch} onclick={() => (query = "")}><XCircle size={16} aria-hidden="true" /></button>{/if}
      </div>
      <SelectControl value={scope} options={[{ value: "all", label: locale === "zh-CN" ? "全部来源" : "All sources" }, ...(["web", "telegram", "feishu", "qq", "weixin"] as const).map(value => ({ value, label: labels[value] }))]} ariaLabel={labels.scopeFilter} onChange={value => selectScope(value as DesktopConversationSearchScope)} />
      <Button onclick={requestClose}><span aria-hidden="true">←</span> {labels.close}</Button>
    </div>
    <div class="agent-history-selection-toolbar">
      <Button disabled={deleting} onclick={() => { selecting = !selecting; selectedIds = []; }}>{locale === "zh-CN" ? (selecting ? "取消多选" : "多选") : (selecting ? "Cancel selection" : "Select")}</Button>
      {#if selecting}
        <Button disabled={deleting || loading} onclick={() => selectedIds = groups.flatMap(group => group.items.map(item => item.sessionId))}>{locale === "zh-CN" ? "选择已加载对话" : "Select loaded conversations"}</Button>
        <Button disabled={deleting || !selectedIds.length} onclick={() => void removeItems(selectedIds)}>{locale === "zh-CN" ? "删除所选" : "Delete selected"} ({selectedIds.length})</Button>
      {/if}
    </div>
    {#if error}<p class="browser-state browser-error" role="alert">{error}</p>{/if}
    <div class="agent-history-table">
      <div class="agent-history-columns" aria-hidden="true"><span>{locale === "zh-CN" ? "对话标题" : "Conversation"}</span><span>{locale === "zh-CN" ? "最后更新" : "Last updated"}</span></div>
      {#if loading}
        <p class="browser-state" role="status">{labels.loading}</p>
      {:else if !totalItems}
        <p class="browser-state">{query ? labels.searchEmpty : labels.empty}</p>
      {:else}
        {#each groups as group (group.source)}
          <div class="agent-history-rows">
            {#each group.items as item (item.sessionId)}
              <AgentConversationRow {item} source={item.source} sourceLabel={scopeLabel(item.source)} {locale} {formatTime} onSelect={() => selecting ? toggleSelection(item.sessionId) : pick(item)} onDelete={() => removeItems([item.sessionId])} selectable={selecting} selected={selectedIds.includes(item.sessionId)} onToggle={() => toggleSelection(item.sessionId)} onCopyPath={onCopyPath ? () => onCopyPath(item) : undefined} onRevealInFinder={onRevealInFinder ? () => onRevealInFinder(item) : undefined} />
            {/each}
          </div>
          {#if group.hasMore}<Button class="agent-history-more" disabled={loadingMore[group.source]} onclick={() => loadMore(group)}>{loadingMore[group.source] ? labels.loading : labels.loadMore}</Button>{/if}
        {/each}
      {/if}
    </div>
  </section>
{:else}
  <Dialog {open} contentClass="conversation-browser-dialog" labelledBy="conversation-browser-title" onOpenChange={handleOpenChange} onOpenAutoFocus={focusSearch}>
    {@render content()}
  </Dialog>
{/if}
