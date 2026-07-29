<script lang="ts">
  import type { Translation } from "../i18n";
  import { fileIconName, fileIconStyle, formatSize } from "./fileIcons";
  import type { ProjectFilesStore } from "./projectFilesStore.svelte";
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
    store: ProjectFilesStore;
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
</script>

{#if level}
  <ul class="file-tree-level" role="group">
    {#each level.entries as entry (entry.path)}
      {@const expanded = Boolean(store.expanded[entry.path])}
      <li class="file-tree-item">
        <div
          class="file-tree-row"
          class:selected={activePath === entry.path}
          class:cursor={cursorPath === entry.path}
          class:dirty={dirtyPaths.has(entry.path)}
          class:touched={touchedPaths.has(entry.path)}
          data-tree-path={entry.path}
          role="treeitem"
          tabindex={-1}
          aria-expanded={entry.kind === "directory" ? expanded : undefined}
          aria-selected={activePath === entry.path}
          oncontextmenu={(event) => onContextMenu(event, entry.path, entry.kind)}
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
              <i class="ph ph-caret-right file-tree-caret" class:open={expanded} aria-hidden="true"></i>
            {:else}
              <span class="file-tree-caret-spacer" aria-hidden="true"></span>
            {/if}
            <i
              class={`ph ${fileIconName(entry.name, entry.kind, expanded)} file-tree-icon`}
              style={fileIconStyle(entry.name, entry.kind)}
              aria-hidden="true"
            ></i>
            <span class="file-tree-name">{entry.name}</span>
            {#if touchedPaths.has(entry.path)}
              <span class="file-tree-touched" title={copy.projectTouchedThisSession} aria-hidden="true"></span>
            {/if}
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
              <i class="ph ph-at" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="file-tree-action"
              aria-label={copy.projectCopyPath}
              title={copy.projectCopyPath}
              onclick={() => onCopyPath(entry.path)}
            >
              <i class={`ph ph-${copiedPath === entry.path ? "check" : "copy"}`} aria-hidden="true"></i>
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
    <p class="file-empty"><i class="ph ph-folder-open" aria-hidden="true"></i><span>{copy.projectFilesEmpty}</span></p>
  {/if}
{/if}
