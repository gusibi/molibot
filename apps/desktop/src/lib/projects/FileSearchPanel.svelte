<script lang="ts">
  import type { Translation } from "../i18n";
  import { escapeHtml } from "./codeHighlight";
  import { fileIconName, fileIconStyle } from "./fileIcons";
  import type { ProjectFilesStore } from "./projectFilesStore.svelte";

  let { store, copy }: { store: ProjectFilesStore; copy: Translation } = $props();

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
    <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
    <input
      type="search"
      bind:this={input}
      value={store.searchQuery}
      placeholder={store.searchMode === "name" ? copy.projectSearchNamePlaceholder : copy.projectSearchContentPlaceholder}
      aria-label={copy.projectSearch}
      oninput={(event) => store.setSearchQuery(event.currentTarget.value)}
      onkeydown={onKeydown}
    />
    <button type="button" aria-label={copy.closePanel} title={copy.closePanel} onclick={() => store.closeSearch()}>
      <i class="ph ph-x" aria-hidden="true"></i>
    </button>
  </div>

  <div class="file-search-modes" role="tablist" aria-label={copy.projectSearch}>
    <button
      type="button"
      role="tab"
      aria-selected={store.searchMode === "name"}
      class:active={store.searchMode === "name"}
      onclick={() => store.setSearchMode("name")}
    >{copy.projectSearchByName}</button>
    <button
      type="button"
      role="tab"
      aria-selected={store.searchMode === "content"}
      class:active={store.searchMode === "content"}
      onclick={() => store.setSearchMode("content")}
    >{copy.projectSearchByContent}</button>
  </div>

  {#if store.searchError}
    <div class="project-panel-error" role="alert">{store.searchError}</div>
  {/if}

  <div class="file-search-results">
    {#if store.searchLoading && !flatHits.length}
      <div class="project-panel-loading"><i class="ph ph-spinner-gap" aria-hidden="true"></i>{copy.loading}</div>
    {:else if !store.searchQuery.trim()}
      <p class="file-search-hint">{copy.projectSearchHint}</p>
    {:else if !flatHits.length}
      <p class="file-search-hint">{copy.projectSearchEmpty}</p>
    {:else if result?.mode === "name"}
      <ul class="file-search-list">
        {#each result.hits as hit, index (hit.path)}
          <li>
            <button type="button" class="file-search-hit" class:cursor={index === cursor} onclick={() => void choose(index)}>
              <i class={`ph ${fileIconName(hit.name, "file")}`} style={fileIconStyle(hit.name, "file")} aria-hidden="true"></i>
              <span class="file-search-hit-name">{hit.name}</span>
              <small class="file-search-hit-path">{hit.path}</small>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="file-search-list file-search-content">
        {#each contentGroups as group (group.path)}
          <li class="file-search-group">
            <p class="file-search-group-head">
              <i class={`ph ${fileIconName(group.name, "file")}`} style={fileIconStyle(group.name, "file")} aria-hidden="true"></i>
              <span>{group.path}</span>
            </p>
            {#each group.lines as entry (entry.line)}
              <button
                type="button"
                class="file-search-line"
                class:cursor={entry.flatIndex === cursor}
                onclick={() => void choose(entry.flatIndex)}
              >
                <span class="file-search-line-number">{entry.line}</span>
                <code>{@html lineHtml(entry.text, entry.start, entry.end)}</code>
              </button>
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
