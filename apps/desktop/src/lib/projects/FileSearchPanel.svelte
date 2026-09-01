<script lang="ts">
  import At from "reicon-svelte/icons/At";
  import Loader from "reicon-svelte/icons/Loader";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import X from "reicon-svelte/icons/X";
  import type { Translation } from "../i18n";
  import { tablist } from "../a11y/tablist";
  import { escapeHtml } from "./codeHighlight";
  import { requestComposerInsertion } from "./composerBridge";
  import { fileIconKind, fileIconStyle } from "./fileIcons";
  import { FILE_KIND_ICONS } from "./fileKindIcons";
  import type { ArtifactTabsStore } from "../artifacts/artifactTabsStore.svelte";

  let { store, copy }: { store: ArtifactTabsStore; copy: Translation } = $props();

  let input = $state<HTMLInputElement | null>(null);
  let cursor = $state(0);

  const result = $derived(store.searchResult);
  const flatHits = $derived(
    result?.mode === "name"
      ? result.hits.map((hit) => ({ path: hit.path, name: hit.name, line: 0 }))
      : (result?.hits ?? []).flatMap((hit) => hit.lines.map((entry) => ({ path: hit.path, name: hit.name, line: entry.line })))
  );

  /**
   * Content hits regrouped by file with their position in `flatHits` attached, so
   * the template never has to search the flat list to find a row's cursor index.
   */
  const contentGroups = $derived.by(() => {
    if (result?.mode !== "content") return [];
    let flatIndex = 0;
    return result.hits.map((hit) => ({
      path: hit.path,
      name: hit.name,
      truncated: hit.truncated,
      lines: hit.lines.map((entry) => ({ ...entry, flatIndex: flatIndex++ }))
    }));
  });

  $effect(() => {
    if (store.searchOpen) queueMicrotask(() => input?.focus());
  });

  // Keep the keyboard cursor inside the current result set.
  $effect(() => {
    flatHits.length;
    cursor = 0;
  });

  async function choose(index: number): Promise<void> {
    const hit = flatHits[index];
    if (!hit) return;
    await store.revealPath(hit.path);
    await store.openFile(hit.path, { revealLine: hit.line });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      cursor = flatHits.length ? (cursor + 1) % flatHits.length : 0;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      cursor = flatHits.length ? (cursor - 1 + flatHits.length) % flatHits.length : 0;
    } else if (event.key === "Enter") {
      event.preventDefault();
      void choose(cursor);
    } else if (event.key === "Escape") {
      event.preventDefault();
      store.closeSearch();
    }
  }

  /** Renders a content-match line with the matched span emphasized. */
  function lineHtml(text: string, start: number, end: number): string {
    return `${escapeHtml(text.slice(0, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>${escapeHtml(text.slice(end))}`;
  }
</script>

<div class="file-search">
  <div class="file-search-field">
    <Magnifier size={14} aria-hidden="true" />
    <input
      type="search"
      bind:this={input}
      value={store.searchQuery}
      placeholder={store.searchMode === "name" ? copy.projectSearchNamePlaceholder : copy.projectSearchContentPlaceholder}
      aria-label={copy.projectSearch}
      autocomplete="off"
      spellcheck="false"
      oninput={(event) => store.setSearchQuery(event.currentTarget.value)}
      onkeydown={onKeydown}
    />
    <button type="button" aria-label={copy.closePanel} title={copy.closePanel} onclick={() => store.closeSearch()}>
      <X size={14} aria-hidden="true" />
    </button>
  </div>

  <div class="file-search-modes" role="tablist" aria-label={copy.projectSearch} use:tablist>
    <button
      type="button"
      role="tab"
      id="file-search-tab-name"
      aria-selected={store.searchMode === "name"}
      aria-controls="file-search-results-panel"
      class:active={store.searchMode === "name"}
      onclick={() => store.setSearchMode("name")}
    >{copy.projectSearchByName}</button>
    <button
      type="button"
      role="tab"
      id="file-search-tab-content"
      aria-selected={store.searchMode === "content"}
      aria-controls="file-search-results-panel"
      class:active={store.searchMode === "content"}
      onclick={() => store.setSearchMode("content")}
    >{copy.projectSearchByContent}</button>
  </div>

  {#if store.searchError}
    <div class="project-panel-error" role="alert">{store.searchError}</div>
  {/if}

  <div id="file-search-results-panel" class="file-search-results" role="tabpanel" aria-labelledby={store.searchMode === "name" ? "file-search-tab-name" : "file-search-tab-content"}>
    {#if store.searchLoading && !flatHits.length}
      <div class="project-panel-loading"><Loader size={18} aria-hidden="true" />{copy.loading}</div>
    {:else if !store.searchQuery.trim()}
      <p class="file-search-hint">{copy.projectSearchHint}</p>
    {:else if !flatHits.length}
      <p class="file-search-hint">{copy.projectSearchEmpty}</p>
    {:else if result?.mode === "name"}
      <ul class="file-search-list">
        {#each result.hits as hit, index (hit.path)}
          {@const HitIcon = FILE_KIND_ICONS[fileIconKind(hit.name, "file")]}
          <li class="file-search-row">
            <button type="button" class="file-search-hit" class:cursor={index === cursor} onclick={() => void choose(index)}>
              <HitIcon size={16} style={fileIconStyle(hit.name, "file")} aria-hidden="true" />
              <span class="file-search-hit-name">{hit.name}</span>
              <small class="file-search-hit-path">{hit.path}</small>
            </button>
            <button
              type="button"
              class="file-tree-action"
              aria-label={copy.projectMentionInChat}
              title={copy.projectMentionInChat}
              onclick={() => requestComposerInsertion(hit.path)}
            ><At size={16} aria-hidden="true" /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="file-search-list file-search-content">
        {#each contentGroups as group (group.path)}
          {@const GroupIcon = FILE_KIND_ICONS[fileIconKind(group.name, "file")]}
          <li class="file-search-group">
            <p class="file-search-group-head">
              <GroupIcon size={16} style={fileIconStyle(group.name, "file")} aria-hidden="true" />
              <span>{group.path}</span>
            </p>
            {#each group.lines as entry (entry.line)}
              <div class="file-search-row">
                <button
                  type="button"
                  class="file-search-line"
                  class:cursor={entry.flatIndex === cursor}
                  onclick={() => void choose(entry.flatIndex)}
                >
                  <span class="file-search-line-number">{entry.line}</span>
                  <code>{@html lineHtml(entry.text, entry.start, entry.end)}</code>
                </button>
                <button
                  type="button"
                  class="file-tree-action"
                  aria-label={copy.projectMentionInChat}
                  title={copy.projectMentionInChat}
                  onclick={() => requestComposerInsertion(group.path, entry.line)}
                ><At size={16} aria-hidden="true" /></button>
              </div>
            {/each}
            {#if group.truncated}<p class="file-search-hint">{copy.projectInspectionTruncated}</p>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if result?.truncated && flatHits.length}
      <p class="file-search-hint">{copy.projectSearchTruncated}</p>
    {/if}
  </div>
</div>
