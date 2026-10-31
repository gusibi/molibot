<script lang="ts">
  import Refresh from "reicon-svelte/icons/Refresh";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import { untrack } from "svelte";
  import { formatDurationMs } from "../api";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { formatNaturalDateTime } from "../presentation";
  import { session } from "../stores/session.svelte";
  import { runHistoryStore, loadRunHistory, refreshRunHistory, runHistoryOutcomeLabel } from "../stores/runHistory.svelte";

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => void loadRunHistory(endpoint));
  });

  const counts = $derived.by(() => {
    const result = { all: runHistoryStore.runHistory.length, success: 0, partial: 0, failed: 0 };
    for (const item of runHistoryStore.runHistory) result[item.reflectionOutcome]++;
    return result;
  });
  const outcomes = ["all", "success", "partial", "failed"] as const;
  const labels = $derived({ all: session.text.runHistoryAll, success: session.text.runHistorySuccess, partial: session.text.runHistoryPartial, failed: session.text.runHistoryFailed });
  const botOptions = $derived(Array.from(new Set(runHistoryStore.runHistory.map(item => item.botId).filter(Boolean))).sort().map(bot => ({ value: bot, label: bot })));
  const filtered = $derived.by(() => {
    const query = runHistoryStore.query.trim().toLocaleLowerCase(session.locale);
    return runHistoryStore.runHistory.filter(item =>
      (runHistoryStore.botId === "all" || item.botId === runHistoryStore.botId) &&
      (runHistoryStore.outcome === "all" || item.reflectionOutcome === runHistoryStore.outcome) &&
      (!query || [item.botId, item.chatId, item.stopReason, item.reflectionOutcome, item.reflectionSummary, ...item.toolNames, ...item.failedToolNames].join("\n").toLocaleLowerCase(session.locale).includes(query))
    );
  });
  const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / runHistoryStore.pageSize)));
  const currentPage = $derived(Math.min(Math.max(1, runHistoryStore.page), totalPages));
  const paged = $derived(filtered.slice((currentPage - 1) * runHistoryStore.pageSize, currentPage * runHistoryStore.pageSize));
  const pending = $derived(runHistoryStore.loading || runHistoryStore.refreshing);

  function outcomeState(outcome: "success" | "partial" | "failed"): "ready" | "warning" | "error" {
    return outcome === "success" ? "ready" : outcome === "partial" ? "warning" : "error";
  }
</script>

<div class="run-history-shell">
  <div class="run-history-toolbar">
    <p class="run-history-scope">{runHistoryStore.loaded ? session.text.runHistoryRecent.replace("{count}", String(counts.all)) : session.text.runHistoryTotal}</p>
    <button class="icon-button" type="button" aria-label={session.text.runHistoryRefresh} title={session.text.runHistoryRefresh} disabled={pending || !session.serviceReady} onclick={refreshRunHistory}>
      <Refresh size={16} aria-hidden="true" />
    </button>
  </div>

  <div class="run-history-stats" role="group" aria-label={session.text.runHistoryTotal}>
    {#each outcomes as outcome}
      <button type="button" class:active={runHistoryStore.outcome === outcome} aria-pressed={runHistoryStore.outcome === outcome} disabled={!runHistoryStore.loaded} onclick={() => { runHistoryStore.outcome = outcome; runHistoryStore.page = 1; }}>
        <span>{labels[outcome]}</span><strong>{runHistoryStore.loaded ? counts[outcome] : "—"}</strong>
      </button>
    {/each}
  </div>

  <div class="run-history-filters">
    <label class="search-field">
      <Magnifier size={16} aria-hidden="true" />
      <input type="search" aria-label={session.text.runHistoryFilter} bind:value={runHistoryStore.query} oninput={() => runHistoryStore.page = 1} autocomplete="off" spellcheck="false" placeholder={session.text.runHistoryFilterHint} />
    </label>
    <SelectControl value={runHistoryStore.botId} ariaLabel={session.text.runHistoryBot} options={[{ value: "all", label: session.text.runHistoryAllBots }, ...botOptions]} onChange={value => { runHistoryStore.botId = value; runHistoryStore.page = 1; }} />
  </div>

  {#if runHistoryStore.refreshing}<p class="run-history-feedback" role="status">{session.text.runHistoryRefreshing}</p>{/if}
  {#if runHistoryStore.error}
    <div class="run-history-error" role="alert">
      <div><strong>{session.text.runHistoryLoadFailed}</strong><p>{runHistoryStore.error}</p></div>
      <button class="secondary-button" type="button" disabled={pending || !session.serviceReady} onclick={refreshRunHistory}>{session.text.retryLoading}</button>
    </div>
  {/if}

  {#if !session.serviceReady}
    <EmptyState title={session.text.runHistoryUnavailable} icon="clock-counter-clockwise" />
  {:else if runHistoryStore.loading}
    <SkeletonRows count={4} label={session.text.loading} />
  {:else if !runHistoryStore.loaded && runHistoryStore.error}
    <!-- The inline error above owns the retry; a failed request is not an empty history. -->
  {:else if runHistoryStore.runHistory.length === 0}
    <EmptyState title={session.text.runHistoryEmpty} icon="clock-counter-clockwise" />
  {:else if filtered.length === 0}
    <EmptyState title={session.text.runHistoryNoMatches} icon="magnifying-glass" />
  {:else}
    <div class="run-history-list" aria-busy={runHistoryStore.refreshing}>
      {#each paged as item, index (item.runId + ':' + item.createdAt + ':' + item.botId + ':' + item.chatId + ':' + index)}
        <article class="run-history-entry">
          <div class="run-history-entry-top">
            <StatusBadge label={item.stopReason === "aborted" ? session.text.runHistoryStopped : item.stopReason === "waiting_for_approval" ? session.text.runHistoryWaiting : runHistoryOutcomeLabel(item.reflectionOutcome, session.text)} state={outcomeState(item.reflectionOutcome)} />
            <span class="run-history-owner">{item.botId}</span>
            <time datetime={item.createdAt}>{formatNaturalDateTime(item.createdAt, session.locale)}</time>
            <span class="run-history-duration">{formatDurationMs(item.durationMs)}</span>
          </div>
          <p class="run-history-entry-summary">{item.reflectionSummary || session.text.runHistoryNoSummary}</p>
          {#if item.failedToolNames.length > 0}<p class="run-history-entry-failed">{session.text.runHistoryFailedTools}: {item.failedToolNames.join(", ")}</p>{/if}
          <details class="run-history-details">
            <summary>{session.text.runHistoryDetails}{#if item.toolNames.length} · {session.text.runHistoryTools} {item.toolNames.length}{/if}</summary>
            <dl>
              <div><dt>{session.text.runHistoryRunId}</dt><dd><code>{item.runId}</code></dd></div>
              {#if item.chatId}<div><dt>{session.text.runHistoryConversation}</dt><dd><code>{item.chatId}</code></dd></div>{/if}
              {#if item.toolNames.length}<div><dt>{session.text.runHistoryTools}</dt><dd>{item.toolNames.join(", ")}</dd></div>{/if}
              {#if item.nextAction}<div><dt>{session.text.runHistoryNextAction}</dt><dd>{item.nextAction}</dd></div>{/if}
            </dl>
            {#if item.usedFallbackModel}<p class="run-history-feedback">{session.text.runHistoryFallback}</p>{/if}
          </details>
        </article>
      {/each}
    </div>
    <div class="run-history-pagination">
      <span>{session.text.runHistoryPage.replace("{page}", String(currentPage)).replace("{pages}", String(totalPages)).replace("{total}", String(filtered.length))}</span>
      <div>
        <SelectControl value={String(runHistoryStore.pageSize)} ariaLabel={session.text.runHistoryPageSize} options={[10, 20, 50, 100].map(value => ({ value: String(value), label: String(value) }))} onChange={value => { runHistoryStore.pageSize = Number(value); runHistoryStore.page = 1; }} />
        <button class="secondary-button" type="button" disabled={currentPage <= 1} onclick={() => runHistoryStore.page = currentPage - 1}>{session.text.runHistoryPrevious}</button>
        <button class="secondary-button" type="button" disabled={currentPage >= totalPages} onclick={() => runHistoryStore.page = currentPage + 1}>{session.text.runHistoryNext}</button>
      </div>
    </div>
  {/if}
</div>
