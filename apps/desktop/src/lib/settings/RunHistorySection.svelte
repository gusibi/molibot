<script lang="ts">
  import { untrack } from "svelte";
  import { formatDurationMs } from "../api";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { formatNaturalDateTime } from "../presentation";
  import { session } from "../stores/session.svelte";
  import {
    runHistoryStore,
    loadRunHistory,
    refreshRunHistory,
    runHistoryOutcomeLabel
  } from "../stores/runHistory.svelte";

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) {
      untrack(() => {
        if (endpoint !== runHistoryStore.endpoint) void loadRunHistory(endpoint);
      });
    }
  });

  const runHistoryCounts = $derived({
    total: runHistoryStore.runHistory.length,
    success: runHistoryStore.runHistory.filter((item) => item.reflectionOutcome === "success").length,
    partial: runHistoryStore.runHistory.filter((item) => item.reflectionOutcome === "partial").length,
    failed: runHistoryStore.runHistory.filter((item) => item.reflectionOutcome === "failed").length
  });

  const botOptions = $derived.by(() => {
    const set = new Set<string>();
    for (const item of runHistoryStore.runHistory) {
      if (item.botId) set.add(item.botId);
    }
    return Array.from(set).sort().map((bot) => ({ value: bot, label: bot }));
  });

  const filteredRunHistory = $derived(
    runHistoryStore.runHistory.filter((item) => {
      if (runHistoryStore.botId !== "all" && item.botId !== runHistoryStore.botId) {
        return false;
      }
      const query = runHistoryStore.query.trim().toLocaleLowerCase(session.locale);
      if (!query) return true;
      return [
        item.botId,
        item.chatId,
        item.stopReason,
        item.reflectionOutcome,
        item.reflectionSummary,
        ...item.toolNames,
        ...item.failedToolNames
      ]
        .join("\n")
        .toLocaleLowerCase(session.locale)
        .includes(query);
    })
  );

  const totalPages = $derived(Math.max(1, Math.ceil(filteredRunHistory.length / runHistoryStore.pageSize)));
  const currentPage = $derived(Math.min(Math.max(1, runHistoryStore.page), totalPages));
  const pagedRunHistory = $derived(
    filteredRunHistory.slice(
      (currentPage - 1) * runHistoryStore.pageSize,
      currentPage * runHistoryStore.pageSize
    )
  );

  function onBotChange(value: string): void {
    runHistoryStore.botId = value;
    runHistoryStore.page = 1;
  }

  function onQueryInput(): void {
    runHistoryStore.page = 1;
  }

  function onPageSizeChange(value: string): void {
    runHistoryStore.pageSize = Number(value) || 20;
    runHistoryStore.page = 1;
  }

  function prevPage(): void {
    if (currentPage > 1) {
      runHistoryStore.page = currentPage - 1;
    }
  }

  function nextPage(): void {
    if (currentPage < totalPages) {
      runHistoryStore.page = currentPage + 1;
    }
  }

  function outcomeState(outcome: "success" | "partial" | "failed"): "ready" | "warning" | "error" {
    if (outcome === "success") return "ready";
    if (outcome === "partial") return "warning";
    return "error";
  }
</script>

{#if !session.serviceReady}
  <div class="settings-card"><EmptyState title={session.text.runHistoryUnavailable} icon="clock-counter-clockwise" /></div>
{:else if runHistoryStore.loading}
  <div class="settings-card"><SkeletonRows count={5} label={session.text.loading} /></div>
{:else if runHistoryStore.runHistory.length === 0}
  <div class="settings-card observatory-filter-card">
    <div class="observatory-filter-toolbar" role="group" aria-label={session.text.runHistoryTotal}>
      <div class="observatory-filter-headline">
        <div class="observatory-filter-title">
          <strong>{session.text.runHistoryTotal}</strong>
          <p>{session.text.runHistoryHint}</p>
        </div>
        <div class="observatory-filter-actions">
          <button
            class="icon-button observatory-refresh-button"
            type="button"
            aria-label={session.text.runHistoryRefresh}
            title={session.text.runHistoryRefresh}
            disabled={runHistoryStore.refreshing}
            onclick={refreshRunHistory}
          >
            <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
  <div class="settings-card"><EmptyState title={session.text.runHistoryEmpty} icon="clock-counter-clockwise" /></div>
{:else}
  <div class="settings-card observatory-filter-card">
    <div class="observatory-filter-toolbar" role="group" aria-label={session.text.runHistoryTotal}>
      <div class="observatory-filter-headline">
        <div class="observatory-filter-title">
          <strong>{session.text.runHistoryTotal}</strong>
          <div class="run-history-counts">
            <span class="status-badge" data-state="ready">{session.text.runHistorySuccess}: {runHistoryCounts.success}</span>
            <span class="status-badge">{session.text.runHistoryPartial}: {runHistoryCounts.partial}</span>
            <span class="status-badge" data-state="error">{session.text.runHistoryFailed}: {runHistoryCounts.failed}</span>
          </div>
        </div>
        <div class="observatory-filter-actions">
          <button
            class="icon-button observatory-refresh-button"
            type="button"
            aria-label={session.text.runHistoryRefresh}
            title={session.text.runHistoryRefresh}
            disabled={runHistoryStore.refreshing}
            onclick={refreshRunHistory}
          >
            <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="observatory-filter-fields run-history-filter-fields">
        <label class="observatory-field">
          <span>{session.text.runHistoryBot}</span>
          <SelectControl
            value={runHistoryStore.botId}
            ariaLabel={session.text.runHistoryBot}
            options={[{ value: "all", label: session.text.runHistoryAllBots }, ...botOptions]}
            onChange={onBotChange}
          />
        </label>
        <label class="observatory-field">
          <span>{session.text.runHistoryFilter}</span>
          <input
            bind:value={runHistoryStore.query}
            oninput={onQueryInput}
            autocomplete="off"
            spellcheck="false"
            placeholder={session.text.runHistoryFilterHint}
          />
        </label>
      </div>
    </div>
  </div>

  {#if filteredRunHistory.length === 0}
    <div class="settings-card"><EmptyState title={session.text.runHistoryNoMatches} icon="magnifying-glass" /></div>
  {:else}
    <div class="settings-card observatory-data-card">
      {#each pagedRunHistory as item, index (item.runId + ':' + item.createdAt + ':' + item.botId + ':' + item.chatId + ':' + index)}
        <div class="settings-row run-history-row">
          <div class="run-history-item">
            <div class="run-history-head">
              <strong>{item.botId} / {item.chatId}</strong>
              <StatusBadge
                label={runHistoryOutcomeLabel(item.reflectionOutcome, session.text)}
                state={outcomeState(item.reflectionOutcome)}
              />
            </div>
            <p class="run-history-meta">
              {formatNaturalDateTime(item.createdAt, session.locale)} · {formatDurationMs(item.durationMs)} · {item.stopReason}
              {#if item.usedFallbackModel} · {session.text.runHistoryFallback}{/if}
            </p>
            {#if item.reflectionSummary}<p class="run-history-summary">{item.reflectionSummary}</p>{/if}
            {#if item.toolNames.length > 0}<p class="run-history-tools">{session.text.runHistoryTools}: {item.toolNames.join(", ")}</p>{/if}
            {#if item.failedToolNames.length > 0}<p class="run-history-tools run-history-failed">{session.text.runHistoryFailedTools}: {item.failedToolNames.join(", ")}</p>{/if}
          </div>
        </div>
      {/each}

      <div class="observatory-pagination">
        <span>
          {session.text.runHistoryPage
            .replace("{page}", String(currentPage))
            .replace("{pages}", String(totalPages))
            .replace("{total}", String(filteredRunHistory.length))}
        </span>
        <div>
          <label>
            {session.text.runHistoryPageSize}
            <SelectControl
              value={String(runHistoryStore.pageSize)}
              ariaLabel={session.text.runHistoryPageSize}
              options={[10, 20, 50, 100].map((value) => ({ value: String(value), label: String(value) }))}
              onChange={onPageSizeChange}
            />
          </label>
          <button
            class="secondary-button"
            type="button"
            disabled={currentPage <= 1}
            onclick={prevPage}
          >
            {session.text.runHistoryPrevious}
          </button>
          <button
            class="secondary-button"
            type="button"
            disabled={currentPage >= totalPages}
            onclick={nextPage}
          >
            {session.text.runHistoryNext}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}


