<script lang="ts">
  import type { Translation } from "../i18n";
  import {
    parseSpreadsheet,
    type SpreadsheetWorkbook,
    type SpreadsheetSheet
  } from "./spreadsheet";

  let {
    name,
    copy,
    sourceKey,
    version,
    loadBytes
  }: {
    name: string;
    copy: Translation;
    /** Stable identity for the file; changing it reloads the workbook. */
    sourceKey: string;
    /** Preview object identity, so a rewritten Project file reloads in place. */
    version?: unknown;
    loadBytes: () => Promise<Blob | ArrayBuffer | Uint8Array>;
  } = $props();

  let loadState = $state<"loading" | "ready" | "error">("loading");
  let workbook = $state<SpreadsheetWorkbook | null>(null);
  let error = $state("");
  let activeSheetIndex = $state(0);
  let loadToken = 0;

  const activeSheet = $derived<SpreadsheetSheet | null>(workbook?.sheets[activeSheetIndex] ?? null);

  async function loadWorkbook(key: string, revision: unknown, loader: () => Promise<Blob | ArrayBuffer | Uint8Array>): Promise<void> {
    const token = ++loadToken;
    // Read the arguments before awaiting so a stale request cannot replace a
    // newer tab when the user clicks through files quickly.
    void key;
    void revision;
    loadState = "loading";
    workbook = null;
    error = "";
    activeSheetIndex = 0;
    try {
      const input = await loader();
      const bytes = input instanceof Blob ? await input.arrayBuffer() : input;
      const parsed = await parseSpreadsheet(bytes);
      if (token !== loadToken) return;
      workbook = parsed;
      loadState = "ready";
    } catch (cause) {
      if (token !== loadToken) return;
      error = cause instanceof Error ? cause.message : String(cause);
      loadState = "error";
    }
  }

  function retry(): void {
    void loadWorkbook(sourceKey, version, loadBytes);
  }

  $effect(() => {
    const key = sourceKey;
    const revision = version;
    const loader = loadBytes;
    void loadWorkbook(key, revision, loader);
  });
</script>

<div class="spreadsheet-table-wrap" aria-label={name}>
  {#if loadState === "loading"}
    <div class="spreadsheet-state"><i class="ph ph-spinner-gap" aria-hidden="true"></i><span>{copy.artifactSpreadsheetLoading}</span></div>
  {:else if loadState === "error"}
    <div class="spreadsheet-state spreadsheet-state-error" role="alert">
      <i class="ph ph-warning-circle" aria-hidden="true"></i>
      <strong>{copy.artifactSpreadsheetFailed}</strong>
      {#if error}<span>{error}</span>{/if}
      <button type="button" onclick={retry}><i class="ph ph-arrow-clockwise" aria-hidden="true"></i>{copy.artifactRefresh}</button>
    </div>
  {:else if !workbook || workbook.sheets.length === 0}
    <div class="spreadsheet-state"><i class="ph ph-table" aria-hidden="true"></i><span>{copy.artifactSpreadsheetEmpty}</span></div>
  {:else if activeSheet}
    <div class="spreadsheet-toolbar">
      <div class="spreadsheet-sheets" role="tablist" aria-label={copy.artifactSpreadsheetSheet}>
        {#each workbook.sheets as sheet, index (index)}
          <button
            type="button"
            role="tab"
            aria-selected={activeSheetIndex === index}
            class:active={activeSheetIndex === index}
            title={sheet.name}
            onclick={() => (activeSheetIndex = index)}
          >{sheet.name}</button>
        {/each}
      </div>
      <span class="spreadsheet-summary">
        {activeSheet.rows.length} {copy.artifactSpreadsheetRows}
        {#if activeSheet.truncated}<span class="spreadsheet-truncated"> · {copy.artifactSpreadsheetTruncated}</span>{/if}
      </span>
    </div>
    {#if activeSheet.headers.length === 0 && activeSheet.rows.length === 0}
      <div class="spreadsheet-state"><i class="ph ph-table" aria-hidden="true"></i><span>{copy.artifactSpreadsheetEmpty}</span></div>
    {:else}
      <div class="spreadsheet-scroll">
        <table class="spreadsheet-table">
          <thead>
            <tr>
              <th class="spreadsheet-row-number" scope="col">#</th>
              {#each activeSheet.headers as header, index (index)}<th scope="col">{header || `${copy.artifactSpreadsheetColumn} ${index + 1}`}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each activeSheet.rows as row, rowIndex (rowIndex)}
              <tr>
                <th class="spreadsheet-row-number" scope="row">{rowIndex + 1}</th>
                {#each row as cell, cellIndex (cellIndex)}<td title={cell}>{cell}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .spreadsheet-table-wrap {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
  }
  .spreadsheet-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: 0 0 auto;
    min-width: 0;
    padding: 6px 12px;
    border-bottom: 1px solid var(--separator);
    color: var(--label-secondary);
    font-size: var(--fs-meta);
  }
  .spreadsheet-sheets {
    display: flex;
    min-width: 0;
    gap: 2px;
    overflow-x: auto;
  }
  .spreadsheet-sheets button {
    flex: 0 0 auto;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--label-secondary);
    padding: 4px 8px;
    cursor: pointer;
    font: inherit;
  }
  .spreadsheet-sheets button:hover,
  .spreadsheet-sheets button.active {
    color: var(--label-primary);
  }
  .spreadsheet-sheets button.active {
    border-bottom-color: var(--accent);
  }
  .spreadsheet-summary {
    flex: 0 0 auto;
    white-space: nowrap;
    color: var(--label-tertiary);
  }
  .spreadsheet-truncated {
    color: var(--warning);
  }
  .spreadsheet-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
  .spreadsheet-table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-meta);
  }
  .spreadsheet-table th,
  .spreadsheet-table td {
    min-width: 96px;
    max-width: 480px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--separator);
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spreadsheet-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--card-bg);
    color: var(--label-secondary);
    font-weight: 600;
  }
  .spreadsheet-table tbody tr:nth-child(even) {
    background: color-mix(in srgb, var(--label-primary) 3%, transparent);
  }
  .spreadsheet-row-number {
    min-width: 42px !important;
    width: 42px;
    color: var(--label-tertiary);
    text-align: right !important;
    user-select: none;
  }
  .spreadsheet-state {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    color: var(--label-secondary);
    text-align: center;
  }
  .spreadsheet-state-error {
    flex-direction: column;
    color: var(--label-secondary);
  }
  .spreadsheet-state-error > i {
    color: var(--danger);
    font-size: var(--icon-lg);
  }
  .spreadsheet-state-error span {
    max-width: 520px;
    color: var(--label-tertiary);
    overflow-wrap: anywhere;
  }
  .spreadsheet-state-error button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--chrome-border);
    border-radius: var(--radius-small);
    background: transparent;
    color: var(--label-secondary);
    padding: 5px 10px;
    cursor: pointer;
    font: inherit;
  }
</style>
