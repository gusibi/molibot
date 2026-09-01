<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import CodeFile from "reicon-svelte/icons/CodeFile";
  import DiagramTree from "reicon-svelte/icons/DiagramTree";
  import Loader from "reicon-svelte/icons/Loader";
  import {
    buildJsonTree,
    visibleJsonRows,
    JSON_TREE_MAX_BYTES,
    type JsonTreeRow,
    type JsonTreeResult
  } from "./jsonTree";
  import CodeViewer from "../projects/CodeViewer.svelte";
  import { formatSize } from "../projects/fileIcons";
  import type { Translation } from "../i18n";

  /**
   * Source-first JSON viewer. The raw document is the safe default; parsing is
   * an explicit user action so opening a JSON file never blocks the panel.
   *
   * Every failure mode has a visible fallback - a parse error, an over-ceiling
   * document, or a row-budget overflow returns to the highlighted source view.
   */
  let {
    content,
    name,
    copy,
    hasMoreBytes = false,
    loadingMore = false,
    loadedBytes = 0,
    sizeBytes = 0,
    onLoadMoreBytes
  }: {
    content: string;
    name: string;
    copy: Translation;
    hasMoreBytes?: boolean;
    loadingMore?: boolean;
    loadedBytes?: number;
    sizeBytes?: number;
    onLoadMoreBytes?: () => void;
  } = $props();

  let treeMode = $state(false);
  let tree = $state<JsonTreeResult | null>(null);
  let collapsed = $state(new Set<string>());
  let appliedFor = $state<JsonTreeRow[] | null>(null);

  /** Reset source-first state whenever a different file or version arrives. */
  $effect(() => {
    content;
    name;
    treeMode = false;
    tree = null;
    collapsed = new Set();
    appliedFor = null;
  });

  $effect(() => {
    const result = tree;
    if (!treeMode || result?.status !== "ok") return;
    if (appliedFor === result.rows) return;
    appliedFor = result.rows;
    collapsed = new Set(result.collapsedByDefault);
  });

  const rows = $derived(treeMode && tree?.status === "ok" ? visibleJsonRows(tree.rows, collapsed) : []);

  function showTree(): void {
    if (hasMoreBytes || loadingMore) return;
    treeMode = true;
    try {
      tree = buildJsonTree(content);
    } catch (cause) {
      tree = { status: "invalid", message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  function showSource(): void {
    treeMode = false;
    tree = null;
    collapsed = new Set();
    appliedFor = null;
  }

  function toggle(path: string): void {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function expandAll(): void {
    collapsed = new Set();
  }

  function collapseAll(): void {
    collapsed = new Set(
      tree?.status === "ok"
        ? tree.rows.filter((row) => row.expandable && row.childCount > 0 && row.depth > 0).map((row) => row.path)
        : []
    );
  }

  function summary(row: JsonTreeRow): string {
    const braces = row.kind === "array" ? ["[", "]"] : ["{", "}"];
    return `${braces[0]}${row.childCount}${braces[1]}`;
  }
</script>

{#if !treeMode}
  <div class="json-source-wrap">
    <div class="json-tree-toolbar">
      <span class="json-tree-mode-label"><CodeFile size={14} aria-hidden="true" />{copy.artifactRawText}</span>
      <button
        type="button"
        class="json-tree-mode-action"
        disabled={hasMoreBytes || loadingMore}
        title={hasMoreBytes ? copy.artifactJsonLoadComplete : copy.artifactJsonTree}
        onclick={showTree}
      >
        <DiagramTree size={14} aria-hidden="true" />{copy.artifactJsonTree}
      </button>
    </div>
    <CodeViewer
      content={content}
      filePath={name}
      {copy}
      {hasMoreBytes}
      {loadingMore}
      {loadedBytes}
      {sizeBytes}
      onLoadMoreBytes={onLoadMoreBytes}
    />
  </div>
{:else if tree?.status === "ok"}
  <div class="json-tree-wrap">
    <div class="json-tree-toolbar">
      <button type="button" class="json-tree-mode-action" onclick={showSource}>
        <CodeFile size={14} aria-hidden="true" />{copy.artifactJsonSource}
      </button>
      <button type="button" onclick={expandAll}>{copy.artifactExpandAll}</button>
      <button type="button" onclick={collapseAll}>{copy.artifactCollapseAll}</button>
    </div>
    <div class="json-tree-scroll">
      {#each rows as row, rowIndex (rowIndex)}
        <div class="json-tree-row" style={`padding-left: ${row.depth * 14 + 10}px`}>
          {#if row.expandable && row.childCount > 0}
            <button
              type="button"
              class="json-tree-caret"
              aria-expanded={!collapsed.has(row.path)}
              aria-label={row.key || copy.artifactJsonRoot}
              onclick={() => toggle(row.path)}
            >
              {#if collapsed.has(row.path)}<CaretRight size={14} aria-hidden="true" />{:else}<AngleDown size={14} aria-hidden="true" />{/if}
            </button>
          {:else}
            <span class="json-tree-caret is-leaf" aria-hidden="true"></span>
          {/if}
          {#if row.key}<span class="json-tree-key">{row.key}</span><span class="json-tree-colon">:</span>{/if}
          {#if row.expandable}
            <span class="json-tree-summary">{summary(row)}</span>
          {:else}
            <span class={`json-tree-value is-${row.kind}`}>{row.value}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{:else if tree}
  <div class="json-source-wrap">
    <div class="json-tree-toolbar">
      <button type="button" class="json-tree-mode-action" onclick={showSource}>
        <CodeFile size={14} aria-hidden="true" />{copy.artifactJsonSource}
      </button>
    </div>
    <p class="project-viewer-note">
      {tree.status === "too-large"
        ? `${copy.artifactJsonTooLarge} · ${formatSize(tree.sizeBytes)} / ${formatSize(JSON_TREE_MAX_BYTES)}`
        : tree.status === "too-many-rows"
          ? copy.artifactJsonTooManyRows
          : `${copy.artifactJsonInvalid} · ${tree.message}`}
    </p>
    <CodeViewer
      content={content}
      filePath={name}
      {copy}
      {hasMoreBytes}
      {loadingMore}
      {loadedBytes}
      {sizeBytes}
      onLoadMoreBytes={onLoadMoreBytes}
    />
  </div>
{:else}
  <div class="project-panel-loading"><Loader size={18} aria-hidden="true" />{copy.loading}</div>
{/if}

<style>
  .json-source-wrap,
  .json-tree-wrap {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }
  .json-tree-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 6px 12px;
    border-bottom: 1px solid var(--separator);
  }
  .json-tree-toolbar button {
    border: 1px solid var(--chrome-border);
    background: transparent;
    color: var(--label-secondary);
    border-radius: var(--radius-small);
    padding: 2px 8px;
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    cursor: pointer;
  }
  .json-tree-toolbar button:hover:not(:disabled) {
    color: var(--label-primary);
    background: var(--fill);
  }
  .json-tree-toolbar button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .json-tree-mode-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    color: var(--label-secondary);
    font: var(--fs-meta) / var(--lh-meta) var(--font-ui);
  }
  .json-tree-mode-action {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .json-tree-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 6px 0 12px;
  }
  .json-tree-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    padding-right: 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .json-tree-row:hover {
    background: var(--fill);
  }
  .json-tree-caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 14px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--label-tertiary);
    font-size: var(--icon-xs);
    cursor: pointer;
  }
  .json-tree-caret.is-leaf {
    cursor: default;
  }
  .json-tree-key {
    color: var(--label-primary);
  }
  .json-tree-colon {
    color: var(--label-tertiary);
  }
  .json-tree-summary {
    color: var(--label-tertiary);
  }
  .json-tree-value.is-string {
    color: var(--online);
  }
  .json-tree-value.is-number,
  .json-tree-value.is-boolean {
    color: var(--accent);
  }
  .json-tree-value.is-null {
    color: var(--label-tertiary);
  }
</style>
