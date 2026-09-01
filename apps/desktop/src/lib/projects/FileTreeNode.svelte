<script lang="ts">
  import At from "reicon-svelte/icons/At";
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import Check from "reicon-svelte/icons/Check";
  import Copy from "reicon-svelte/icons/Copy";
  import FolderOpen from "reicon-svelte/icons/FolderOpen";
  import type { Translation } from "../i18n";
  import { fileIconKind, fileIconStyle, formatSize } from "./fileIcons";
  import { FILE_KIND_ICONS } from "./fileKindIcons";
  import type { ArtifactTabsStore } from "../artifacts/artifactTabsStore.svelte";
  import FileTreeNode from "./FileTreeNode.svelte";

  let {
    store,
    dirPath,
    depth = 0,
    copy,
    dirtyPaths,
    touchedPaths,
    onCopyPath,
    onMention,
    onContextMenu,
    copiedPath
  }: {
    store: ArtifactTabsStore;
    dirPath: string;
    depth?: number;
    copy: Translation;
    dirtyPaths: Set<string>;
    touchedPaths: Set<string>;
    onCopyPath: (path: string) => void;
    onMention: (path: string) => void;
    onContextMenu: (event: MouseEvent, path: string, kind: string) => void;
    copiedPath: string;
  } = $props();

  const level = $derived(store.dirs[dirPath]);
  const activePath = $derived(store.activeTab?.path ?? "");
  const cursorPath = $derived(store.cursorPath);

  /** Keyboard route (Shift+F10 / ContextMenu key) to the same menu as right-click. */
  function onContextMenuForKeyboard(event: KeyboardEvent, path: string, kind: string): void {
    if (!((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onContextMenu(new MouseEvent("contextmenu", { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }), path, kind);
  }
</script>

{#if level}
  <ul class="file-tree-level">
    {#each level.entries as entry (entry.path)}
      {@const expanded = Boolean(store.expanded[entry.path])}
      {@const NodeIcon = FILE_KIND_ICONS[fileIconKind(entry.name, entry.kind, expanded)]}
      <li class="file-tree-item">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="file-tree-row"
          class:selected={activePath === entry.path}
          class:cursor={cursorPath === entry.path}
          class:dirty={dirtyPaths.has(entry.path)}
          class:touched={touchedPaths.has(entry.path)}
          data-tree-path={entry.path}
          onkeydown={(event) => {
            // Keyboard route to the right-click-only menu (Shift+F10 / ContextMenu key).
            if (!((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")) return;
            event.preventDefault();
            onContextMenuForKeyboard(event, entry.path, entry.kind);
          }}
        >
          <button
            type="button"
            class="file-tree-button"
            style={`--depth:${depth}`}
            aria-expanded={entry.kind === "directory" ? expanded : undefined}
            disabled={entry.kind === "symlink"}
            title={entry.path}
            onclick={() => {
              store.cursorPath = entry.path;
              if (entry.kind === "directory") store.toggleDir(entry.path);
              else if (entry.kind === "file") void store.openFile(entry.path);
            }}
          >
            {#if entry.kind === "directory"}
              <i class={expanded ? "file-tree-caret open" : "file-tree-caret"} aria-hidden="true"><CaretRight size={11} /></i>
            {:else}
              <span class="file-tree-caret-spacer" aria-hidden="true"></span>
            {/if}
            <NodeIcon
              class="file-tree-icon"
              size={16}
              style={fileIconStyle(entry.name, entry.kind)}
              aria-hidden="true"
            />
            <span class="file-tree-name">{entry.name}</span>
            {#if entry.sizeBytes !== undefined}<small class="file-tree-size">{formatSize(entry.sizeBytes)}</small>{/if}
          </button>
          {#if entry.kind !== "symlink"}
            <button
              type="button"
              class="file-tree-action"
              aria-label={copy.projectMentionInChat}
              title={copy.projectMentionInChat}
              onclick={() => onMention(entry.path)}
            >
              <At size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="file-tree-action"
              aria-label={copy.projectCopyPath}
              title={copy.projectCopyPath}
              onclick={() => onCopyPath(entry.path)}
            >
              {#if copiedPath === entry.path}<Check size={16} aria-hidden="true" />{:else}<Copy size={16} aria-hidden="true" />{/if}
            </button>
          {/if}
        </div>

        {#if entry.kind === "directory" && expanded}
          {#if store.dirs[entry.path]}
            <FileTreeNode
              {store}
              dirPath={entry.path}
              depth={depth + 1}
              {copy}
              {dirtyPaths}
              {touchedPaths}
              {onCopyPath}
              {onMention}
              {onContextMenu}
              {copiedPath}
            />
          {:else}
            <p class="file-tree-hint" style={`--depth:${depth + 1}`}>{copy.loading}</p>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>

  {#if level.error}
    <p class="file-tree-hint file-tree-error" style={`--depth:${depth}`}>{level.error}</p>
  {:else if level.nextCursor}
    <button
      type="button"
      class="file-tree-more"
      style={`--depth:${depth}`}
      onclick={() => void store.loadDir(dirPath, { append: true })}
      disabled={level.loading}
    >{level.loading ? copy.loading : copy.loadMore}</button>
  {:else if !level.entries.length && !level.loading && !dirPath}
    <p class="file-empty"><FolderOpen size={20} aria-hidden="true" /><span>{copy.projectFilesEmpty}</span></p>
  {/if}
{/if}
