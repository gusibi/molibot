<script lang="ts">
  import { formatDurationMs } from "../api";
  import { session } from "../stores/session.svelte";
  import { runHistoryStore, loadRunHistory, runHistoryOutcomeLabel } from "../stores/runHistory.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== runHistoryStore.endpoint) {
      void loadRunHistory(session.endpoint);
    }
  });

  const runHistoryCounts = $derived({
    total: runHistoryStore.runHistory.length,
    success: runHistoryStore.runHistory.filter((item) => item.reflectionOutcome === "success").length,
    partial: runHistoryStore.runHistory.filter((item) => item.reflectionOutcome === "partial").length,
    failed: runHistoryStore.runHistory.filter((item) => item.reflectionOutcome === "failed").length
  });
  const filteredRunHistory = $derived(runHistoryStore.runHistory.filter((item) => {
    const query = runHistoryStore.query.trim().toLocaleLowerCase(session.locale);
    if (!query) return true;
    return [item.botId, item.chatId, item.stopReason, item.reflectionOutcome, item.reflectionSummary, ...item.toolNames, ...item.failedToolNames]
      .join("\n")
      .toLocaleLowerCase(session.locale)
      .includes(query);
  }));
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.runHistoryUnavailable}</p></div></div>
{:else if runHistoryStore.loading}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else if runHistoryStore.runHistory.length === 0}
  <div class="settings-card"><div class="settings-row"><p>{session.text.runHistoryEmpty}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row">
      <div><strong>{session.text.runHistoryTotal}</strong></div>
      <div class="run-history-counts">
        <span class="status-badge" data-state="ready">{session.text.runHistorySuccess}: {runHistoryCounts.success}</span>
        <span class="status-badge">{session.text.runHistoryPartial}: {runHistoryCounts.partial}</span>
        <span class="status-badge" data-state="error">{session.text.runHistoryFailed}: {runHistoryCounts.failed}</span>
      </div>
    </div>
  </div>
  <div class="settings-card provider-editor"><div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.runHistoryFilter}</span><input bind:value={runHistoryStore.query} placeholder={session.text.runHistoryFilterHint} /></label></div></div>
  {#if filteredRunHistory.length === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.runHistoryNoMatches}</p></div></div>
  {:else}
  <div class="settings-card">
    {#each filteredRunHistory as item (item.runId)}
      <div class="settings-row run-history-row">
        <div class="run-history-item">
          <div class="run-history-head">
            <strong>{item.botId} / {item.chatId}</strong>
            <span class="status-badge" data-state={item.reflectionOutcome === "success" ? "ready" : item.reflectionOutcome === "failed" ? "error" : "disconnected"}>{runHistoryOutcomeLabel(item.reflectionOutcome, session.text)}</span>
          </div>
          <p class="run-history-meta">
            {item.createdAt.slice(0, 19).replace("T", " ")} · {formatDurationMs(item.durationMs)} · {item.stopReason}
            {#if item.usedFallbackModel} · {session.text.runHistoryFallback}{/if}
          </p>
          {#if item.reflectionSummary}<p class="run-history-summary">{item.reflectionSummary}</p>{/if}
          {#if item.toolNames.length > 0}<p class="run-history-tools">{session.text.runHistoryTools}: {item.toolNames.join(", ")}</p>{/if}
          {#if item.failedToolNames.length > 0}<p class="run-history-tools run-history-failed">{session.text.runHistoryFailedTools}: {item.failedToolNames.join(", ")}</p>{/if}
        </div>
      </div>
    {/each}
  </div>
  {/if}
{/if}
