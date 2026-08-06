<script lang="ts">
  import {
    buildJsonTree,
    visibleJsonRows,
    JSON_TREE_MAX_BYTES,
    type JsonTreeRow
  } from "./jsonTree";
  import { formatSize } from "../projects/fileIcons";
  import type { Translation } from "../i18n";

  /**
   * Collapsible JSON tree (PRD §3.38 Slice 2). Containers deeper than two levels
   * open collapsed so a large document is readable on arrival.
   *
   * Every failure mode has a visible fallback - a parse error and an
   * over-ceiling document both render the source with a note rather than a blank
   * tab. The flattening, the depth default and the byte ceiling live in
   * `jsonTree.ts` so they are unit-tested without a DOM.
   */
  let { content, copy }: { content: string; copy: Translation } = $props();

  const tree = $derived(buildJsonTree(content));

  /**
   * Reset whenever the parse result changes: collapse state keyed on paths from
   * a previous document would silently hide unrelated rows.
   */
  let collapsed = $state(new Set<string>());
  let appliedFor = $state<JsonTreeRow[] | null>(null);

  $effect(() => {
    const result = tree;
    if (result.status !== "ok") {
      if (appliedFor !== null) {
        appliedFor = null;
        collapsed = new Set();
      }
      return;
    }
    if (appliedFor === result.rows) return;
    appliedFor = result.rows;
    collapsed = new Set(result.collapsedByDefault);
  });

  const rows = $derived(tree.status === "ok" ? visibleJsonRows(tree.rows, collapsed) : []);

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
      tree.status === "ok"
        ? tree.rows.filter((row) => row.expandable && row.childCount > 0 && row.depth > 0).map((row) => row.path)
        : []
    );
  }

  function summary(row: JsonTreeRow): string {
    const braces = row.kind === "array" ? ["[", "]"] : ["{", "}"];
    return `${braces[0]}${row.childCount}${braces[1]}`;
  }
</script>

{#if tree.status === "ok"}
  <div class="json-tree-wrap">
    <div class="json-tree-toolbar">
      <button type="button" onclick={expandAll}>{copy.artifactExpandAll}</button>
      <button type="button" onclick={collapseAll}>{copy.artifactCollapseAll}</button>
    </div>
    <div class="json-tree-scroll">
      {#each rows as row (row.path)}
        <div class="json-tree-row" style={`padding-left: ${row.depth * 14 + 10}px`}>
          {#if row.expandable && row.childCount > 0}
            <button
              type="button"
              class="json-tree-caret"
              aria-expanded={!collapsed.has(row.path)}
              aria-label={row.key || copy.artifactJsonRoot}
              onclick={() => toggle(row.path)}
            >
              <i class={`ph ph-caret-${collapsed.has(row.path) ? "right" : "down"}`} aria-hidden="true"></i>
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
{:else}
  <p class="project-viewer-note">
    {tree.status === "too-large"
      ? `${copy.artifactJsonTooLarge} · ${formatSize(tree.sizeBytes)} / ${formatSize(JSON_TREE_MAX_BYTES)}`
      : `${copy.artifactJsonInvalid} · ${tree.message}`}
  </p>
  <pre class="json-tree-raw">{content}</pre>
{/if}

<style>
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
  .json-tree-toolbar button:hover {
    color: var(--label-primary);
    background: var(--fill);
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
    flex: 0 0 auto;
    width: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    padding: 0;
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
  .json-tree-raw {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 12px 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--label-primary);
  }
</style>
