<script lang="ts">
  import { onMount } from "svelte";
  import { formatDurationMs, formatTokenCount, loadDesktopActiveRuns, stopDesktopActiveRun } from "../api";
  import type { DesktopActiveRunItem, DesktopTraceRange } from "@molibot/desktop-contract";
  import { session } from "../stores/session.svelte";
  import { traceStore, TRACE_RANGES, changeTraceRange, loadTrace, traceRangeLabel } from "../stores/trace.svelte";
  import { DONUT_R, donutSegments, percentOf } from "./charts";

  let activeRuns = $state<DesktopActiveRunItem[]>([]);
  let activeRunsLoading = $state(false);
  let activeRunBusy = $state("");
  let activeRunMessage = $state("");

  async function refreshActiveRuns(): Promise<void> {
    if (!session.serviceReady || !session.endpoint) { activeRuns = []; return; }
    activeRunsLoading = activeRuns.length === 0;
    try { activeRuns = await loadDesktopActiveRuns(session.endpoint); }
    catch { activeRuns = []; }
    finally { activeRunsLoading = false; }
  }

  async function stopActiveRun(item: DesktopActiveRunItem): Promise<void> {
    if (!session.endpoint || activeRunBusy || !window.confirm(item.status === "orphan" ? session.text.traceClearOrphanConfirm : session.text.traceStopRunConfirm)) return;
    activeRunBusy = item.runId;
    activeRunMessage = "";
    try {
      const result = await stopDesktopActiveRun(session.endpoint, item.runId);
      activeRunMessage = result === "stopped" ? session.text.traceRunStopped : session.text.traceOrphanCleared;
      await refreshActiveRuns();
    } catch (cause) { activeRunMessage = cause instanceof Error ? cause.message : String(cause); }
    finally { activeRunBusy = ""; }
  }

  onMount(() => {
    void refreshActiveRuns();
    const timer = setInterval(() => void refreshActiveRuns(), 3000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== traceStore.endpoint) {
      void loadTrace(session.endpoint);
      void refreshActiveRuns();
    }
  });

  const trace = $derived(traceStore.trace);
  const traceActivityItems = $derived(trace
    ? [
        { key: "tools", label: session.text.traceToolCalls, value: trace.totals.toolCalls, color: "var(--chart-blue)" },
        { key: "models", label: session.text.traceModelCalls, value: trace.totals.modelCalls, color: "var(--chart-purple)" },
        { key: "skills", label: session.text.traceSkills, value: trace.totals.skillUsages, color: "var(--chart-teal)" },
        { key: "runs", label: session.text.traceRuns, value: trace.totals.runs, color: "var(--chart-indigo)" }
      ]
    : []);
  const traceActivityMax = $derived(Math.max(1, ...traceActivityItems.map((item) => item.value)));
  const traceOutcomeItems = $derived(trace
    ? [
        { key: "ok", label: session.text.traceSucceeded, value: Math.max(0, trace.totals.executedToolCalls - trace.totals.failedTools), color: "var(--chart-green)" },
        { key: "failed", label: session.text.traceFailed, value: trace.totals.failedTools, color: "var(--chart-red)" },
        { key: "blocked", label: session.text.traceBlocked, value: trace.totals.blockedTools, color: "var(--chart-orange)" }
      ]
    : []);
  const traceOutcomeTotal = $derived(traceOutcomeItems.reduce((sum, item) => sum + item.value, 0));
  const traceOutcomeSegments = $derived(donutSegments(traceOutcomeItems));
  const traceDurationMax = $derived(trace ? Math.max(1, trace.totals.avgToolDurationMs, trace.totals.avgModelDurationMs) : 1);
  const traceCoverageItems = $derived(trace
    ? [
        { key: "bots", label: session.text.traceBots, value: trace.totals.bots, icon: "robot" },
        { key: "channels", label: session.text.traceChannels, value: trace.totals.channels, icon: "broadcast" },
        { key: "chats", label: session.text.traceChats, value: trace.totals.chats, icon: "chats-circle" },
        { key: "sessions", label: session.text.traceSessions, value: trace.totals.sessions, icon: "identification-card" }
      ]
    : []);
</script>

<p class="settings-section-hint">{session.text.traceHint}</p>
<p class="settings-group-title">{session.text.traceActiveRuns}</p>
<div class="settings-card trace-active-runs">
  {#if activeRunsLoading}<div class="settings-row"><p>{session.text.loading}</p></div>
  {:else if activeRuns.length === 0}<div class="settings-row"><div class="profile-info"><strong>{session.text.traceNoActiveRuns}</strong><p>{session.text.traceNoActiveRunsHint}</p></div></div>
  {:else}{#each activeRuns as item (item.runId)}
    <div class="settings-row trace-active-run-row">
      <div class="profile-info"><div class="trace-active-run-title"><strong>{item.agentName} · {item.botName}</strong><span class="status-badge" data-state={item.status === "running" ? "ready" : "error"}>{item.status === "running" ? session.text.traceRunRunning : item.status === "stuck" ? session.text.traceRunStuck : session.text.traceRunOrphan}</span></div><p>{item.channel} · {formatDurationMs(item.durationMs)} · {item.startedAt.replace("T", " ").slice(0, 19)}</p><p class="trace-active-run-task">{item.taskPreview || session.text.traceTaskUnavailable}</p></div>
      <button class="secondary-button danger-action" type="button" disabled={Boolean(activeRunBusy)} onclick={() => void stopActiveRun(item)}>{item.status === "orphan" ? session.text.traceClearOrphan : session.text.traceStopRun}</button>
    </div>
  {/each}{/if}
</div>
{#if activeRunMessage}<p class="settings-section-hint">{activeRunMessage}</p>{/if}
<div class="settings-card">
  <div class="settings-row">
    <div>
      <strong>{session.text.traceRange}</strong>
      <p>{trace ? `${trace.window.startDate} → ${trace.window.endDate} · ${trace.timezone}` : ""}</p>
    </div>
    <select value={traceStore.range} disabled={traceStore.loading} aria-label={session.text.traceRange} onchange={(event) => void changeTraceRange((event.currentTarget as HTMLSelectElement).value as DesktopTraceRange)}>
      {#each TRACE_RANGES as range (range)}
        <option value={range}>{traceRangeLabel(range, session.text)}</option>
      {/each}
    </select>
  </div>
</div>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.traceUnavailable}</p></div></div>
{:else if traceStore.loading}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else if !trace}
  <div class="settings-card"><div class="settings-row"><p>{session.text.traceEmpty}</p></div></div>
{:else}
  <div class="chart-kpi-grid">
    <div class="chart-kpi" style="--kpi-accent:var(--chart-indigo)">
      <span class="chart-kpi-label">{session.text.traceFacts}</span>
      <strong class="chart-kpi-value">{formatTokenCount(trace.totals.facts)}</strong>
      <span class="chart-kpi-foot">{formatTokenCount(trace.totals.runs)} {session.text.traceRuns}</span>
    </div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-blue)">
      <span class="chart-kpi-label">{session.text.traceToolCalls}</span>
      <strong class="chart-kpi-value">{formatTokenCount(trace.totals.toolCalls)}</strong>
      <span class="chart-kpi-foot">{session.text.traceFailed} {trace.totals.failedTools} · {session.text.traceBlocked} {trace.totals.blockedTools}</span>
    </div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-purple)">
      <span class="chart-kpi-label">{session.text.traceModelCalls}</span>
      <strong class="chart-kpi-value">{formatTokenCount(trace.totals.modelCalls)}</strong>
      <span class="chart-kpi-foot">{formatTokenCount(trace.totals.totalTokens)} {session.text.usageTokens}</span>
    </div>
    <div class="chart-kpi" style="--kpi-accent:var(--chart-teal)">
      <span class="chart-kpi-label">{session.text.traceSkills}</span>
      <strong class="chart-kpi-value">{formatTokenCount(trace.totals.skillUsages)}</strong>
      <span class="chart-kpi-foot">{formatTokenCount(trace.totals.distinctSkills)} {session.text.traceDistinct}</span>
    </div>
  </div>

  <div class="settings-card chart-card">
    <div class="chart-card-head"><div><strong>{session.text.traceActivity}</strong></div></div>
    <div class="hbar-list">
      {#each traceActivityItems as item (item.key)}
        <div class="hbar-row">
          <span class="hbar-label">{item.label}</span>
          <div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(item.value, traceActivityMax))}%; background:{item.color}"></span></div>
          <span class="hbar-value">{formatTokenCount(item.value)}</span>
        </div>
      {/each}
    </div>
  </div>

  <div class="chart-split">
    <div class="settings-card chart-card">
      <div class="chart-card-head"><div><strong>{session.text.traceToolOutcome}</strong></div></div>
      <div class="donut-block">
        <div class="donut-wrap">
          <svg class="donut-svg" viewBox="0 0 42 42" role="img" aria-label={session.text.traceToolOutcome}>
            <circle class="donut-track" cx="21" cy="21" r={DONUT_R} />
            {#each traceOutcomeSegments as seg (seg.key)}
              <circle class="donut-seg" cx="21" cy="21" r={DONUT_R} stroke={seg.color} stroke-dasharray="{seg.len} {100 - seg.len}" stroke-dashoffset={seg.offset} />
            {/each}
          </svg>
          <div class="donut-center">
            <strong>{formatTokenCount(trace.totals.toolCalls)}</strong>
            <small>{session.text.traceToolCalls}</small>
          </div>
        </div>
        <ul class="chart-legend">
          {#each traceOutcomeItems as item (item.key)}
            <li>
              <span class="legend-dot" style="background:{item.color}"></span>
              <span class="legend-name">{item.label}</span>
              <span class="legend-value">{formatTokenCount(item.value)}<em>{percentOf(item.value, traceOutcomeTotal)}%</em></span>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <div class="settings-card chart-card">
      <div class="chart-card-head"><div><strong>{session.text.traceCoverage}</strong></div></div>
      <div class="coverage-grid">
        {#each traceCoverageItems as item (item.key)}
          <div class="coverage-tile">
            <span class="coverage-icon"><i class="ph ph-{item.icon}"></i></span>
            <strong>{formatTokenCount(item.value)}</strong>
            <small>{item.label}</small>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div class="settings-card chart-card">
    <div class="chart-card-head"><div><strong>{session.text.traceDurationCompare}</strong></div></div>
    <div class="hbar-list">
      <div class="hbar-row">
        <span class="hbar-label">{session.text.traceTool}</span>
        <div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(trace.totals.avgToolDurationMs, traceDurationMax))}%; background:var(--chart-blue)"></span></div>
        <span class="hbar-value">{formatDurationMs(trace.totals.avgToolDurationMs)}</span>
      </div>
      <div class="hbar-row">
        <span class="hbar-label">{session.text.traceModel}</span>
        <div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(trace.totals.avgModelDurationMs, traceDurationMax))}%; background:var(--chart-purple)"></span></div>
        <span class="hbar-value">{formatDurationMs(trace.totals.avgModelDurationMs)}</span>
      </div>
    </div>
  </div>
{/if}
