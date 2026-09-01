<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import AngleUp from "reicon-svelte/icons/AngleUp";
  import Sort from "reicon-svelte/icons/Sort";
  import { parseCsv, sortCsvRows } from "./csvTable";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import CodeViewer from "../projects/CodeViewer.svelte";
  import type { Translation } from "../i18n";

  /**
   * CSV/TSV table viewer (PRD §3.38 Slice 1c). First row is the header; no type
   * inference, filtering or editing. A Table/Raw toggle (IosSwitch) always lets
   * the user fall back to the exact bytes, and a parse failure falls back to
   * source automatically - the caller also falls back to CodeViewer, but this
   * guard keeps a re-parse failure from blanking the tab.
   *
   * Sorting: click a header to sort by that column (asc -> desc -> off). The
   * comparator lives in `csvTable.ts` next to the parser it operates on, and
   * the sort resets when a different table is opened in the same slot.
   *
   * The Raw view reuses the shared CodeViewer so it carries line numbers and the
   * same find/wrap controls as every other text file (issue #31 bug 4). The
   * {#each} keys are row/column indexes, not cell values: Svelte 5 throws
   * `each_key_duplicate` (in production, not just dev) on repeated keys, and a
   * row like `yes,yes,yes,yes` or two identical rows is common in data CSVs -
   * which blanked the tab before (issue #31 bug 1).
   *
   * `large` is the fullscreen artifact-lightbox presentation: the same viewer
   * and the same interactions, sized for reading across a whole window instead
   * of an inspector pane.
   */
  let { content, copy, name, large = false }: { content: string; copy: Translation; name: string; large?: boolean } = $props();

  let showRaw = $state(false);
  let sort: { column: number; dir: 1 | -1 } | null = $state(null);

  // A different table opened in the same slot must not inherit the previous sort.
  $effect(() => { void content; sort = null; });

  const parsed = $derived.by(() => {
    try {
      return { ok: true as const, result: parseCsv(content) };
    } catch {
      return { ok: false as const, result: null };
    }
  });

  const sortedRows = $derived.by(() => {
    if (!parsed.result) return [];
    if (!sort) return parsed.result.rows;
    return sortCsvRows(parsed.result.rows, sort.column, sort.dir);
  });

  function toggleSort(column: number): void {
    if (sort?.column !== column) sort = { column, dir: 1 };
    else if (sort.dir === 1) sort = { column, dir: -1 };
    else sort = null;
  }

  function sortState(column: number): "ascending" | "descending" | "none" {
    if (sort?.column !== column) return "none";
    return sort.dir === 1 ? "ascending" : "descending";
  }

  const SORT_ICONS = { sort: Sort, asc: AngleUp, desc: AngleDown } as const;

  function sortIcon(column: number): (typeof SORT_ICONS)[keyof typeof SORT_ICONS] {
    if (sort?.column !== column) return SORT_ICONS.sort;
    return sort.dir === 1 ? SORT_ICONS.asc : SORT_ICONS.desc;
  }
</script>

<div class="csv-table-wrap" class:large>
  <div class="csv-toolbar">
    <label class="csv-toggle">
      <IosSwitch checked={showRaw} onCheckedChange={(value) => (showRaw = value)} ariaLabel={copy.artifactRawText} />
      <span>{copy.artifactRawText}</span>
    </label>
    {#if parsed.ok && parsed.result?.truncated}
      <span class="csv-truncated" role="status">{copy.artifactTruncated}</span>
    {/if}
  </div>

  {#if showRaw || !parsed.ok}
    <CodeViewer content={content} filePath={name} {copy} />
  {:else if parsed.result}
    <div class="csv-scroll">
      <table class="csv-table">
        <thead>
          <tr>
            {#each parsed.result.headers as header, i (i)}
              {@const SortIcon = sortIcon(i)}
              <th scope="col" aria-sort={sortState(i)}>
                <button type="button" class="csv-sort" onclick={() => toggleSort(i)} title={copy.csvSortColumn} aria-label={`${copy.csvSortColumn}: ${header}`}>
                  <span>{header}</span>
                  <SortIcon size={12} aria-hidden="true" />
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as row, i (i)}
            <tr>{#each row as cell, j (j)}<td>{cell}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .csv-table-wrap {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }
  .csv-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: 0 0 auto;
    padding: 6px 12px;
    border-bottom: 1px solid var(--separator);
    color: var(--label-secondary);
    font-size: var(--fs-meta);
  }
  .csv-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .csv-truncated {
    color: var(--warning);
  }
  .csv-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
  .csv-table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-meta);
  }
  .csv-table th,
  .csv-table td {
    padding: 4px 10px;
    text-align: left;
    border-bottom: 1px solid var(--separator);
    white-space: nowrap;
    max-width: 480px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .csv-table th {
    position: sticky;
    top: 0;
    background: var(--card-bg);
    color: var(--label-secondary);
    font-weight: 600;
    z-index: 1;
  }
  .csv-table tbody tr:nth-child(even) {
    background: color-mix(in srgb, var(--label-primary) 3%, transparent);
  }
  .csv-sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: -4px -6px;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--rounded-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .csv-sort:hover {
    background: color-mix(in srgb, var(--label-primary) 8%, transparent);
    color: var(--label-primary);
  }
  .csv-sort:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 0;
  }
  .csv-sort :global(svg) {
    font-size: 11px;
    opacity: 0.55;
  }
  th[aria-sort="ascending"] .csv-sort :global(svg),
  th[aria-sort="descending"] .csv-sort :global(svg) {
    opacity: 0.95;
    color: var(--accent);
  }
  /* Fullscreen lightbox sizing: the same viewer, legible across a whole window. */
  .csv-table-wrap.large .csv-toolbar {
    font-size: var(--fs-label);
  }
  .csv-table-wrap.large .csv-table {
    font-size: 13px;
  }
  .csv-table-wrap.large .csv-table th,
  .csv-table-wrap.large .csv-table td {
    padding: 9px 14px;
    line-height: 20px;
  }
  .csv-table-wrap.large .csv-sort {
    margin: -9px -8px;
    padding: 9px 8px;
  }
</style>
