<script lang="ts">
  import ArrowRightUp from "reicon-svelte/icons/ArrowRightUp";
  import Layers from "reicon-svelte/icons/Layers";
  import PauseCircle from "reicon-svelte/icons/PauseCircle";
  import type { DesktopDurableExecutionItem, DesktopDurableExecutionStatus } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  export let item: DesktopDurableExecutionItem;
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let onOpen: (executionId: string) => void;

  const statusKeys: Record<DesktopDurableExecutionStatus, keyof Translation> = {
    planned: "durableStatusPlanned",
    queued: "durableStatusQueued",
    running: "durableStatusRunning",
    verifying: "durableStatusVerifying",
    waiting_for_user: "durableStatusWaitingForUser",
    waiting_for_approval: "durableStatusWaitingForApproval",
    paused: "durableStatusPaused",
    recovery_required: "durableStatusRecoveryRequired",
    partial: "durableStatusPartial",
    completed: "durableStatusCompleted",
    failed: "durableStatusFailed",
    cancelled: "durableStatusCancelled"
  };

  $: progress = item.projection.progress.total > 0
    ? Math.min(100, Math.round(item.projection.progress.completed / item.projection.progress.total * 100))
    : 0;
  $: statusLabel = copy[statusKeys[item.execution.status]];
  $: stepProgress = copy.durableStepProgress
    .replace("{completed}", String(item.projection.progress.completed))
    .replace("{total}", String(item.projection.progress.total));
</script>

<article class="durable-execution-card" data-status={item.execution.status}>
  <header class="durable-execution-card-head">
    <div class="durable-execution-card-mark" aria-hidden="true">
      <Layers size={14} />
    </div>
    <div class="durable-execution-card-title">
      <p>{copy.durableExecution} · <code>{item.execution.shortHandle}</code></p>
      <h3>{item.execution.goal}</h3>
    </div>
    <span class="durable-execution-status">
      <span class="durable-execution-status-dot" aria-hidden="true"></span>{statusLabel}
    </span>
  </header>

  <div class="durable-execution-card-progress" aria-label={copy.durableProgress}>
    <div
      class="durable-execution-progress-track"
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span style={"transform: scaleX(" + progress / 100 + ")"}></span>
    </div>
    <div class="durable-execution-progress-meta">
      <span>{stepProgress}</span>
      {#if item.projection.queuePosition !== undefined}
        <span>{copy.durableQueueAhead.replace("{count}", String(Math.max(0, item.projection.queuePosition - 1)))}</span>
      {:else if item.projection.nextStep}
        <span>{copy.durableNextStep}: {item.projection.nextStep.title}</span>
      {:else}
        <span>{copy.durableNoNextStep}</span>
      {/if}
    </div>
  </div>

  {#if item.projection.waiting}
    <p class="durable-execution-waiting">
      <PauseCircle size={14} aria-hidden="true" />
      <span><strong>{copy.durableWaitingReason}</strong>{item.projection.waiting.reason}</span>
    </p>
  {/if}

  <footer class="durable-execution-card-foot">
    <span>{copy.durableUpdated.replace("{time}", formatTime(item.execution.updatedAt))}</span>
    <button type="button" class="durable-execution-open" onclick={() => onOpen(item.execution.id)}>
      {copy.durableOpen}<ArrowRightUp size={12} aria-hidden="true" />
    </button>
  </footer>
</article>

<style>
  .durable-execution-card {
    display: grid;
    gap: 12px;
    margin: 16px auto;
    width: min(100%, 720px);
    padding: 14px 16px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-panel);
    background: var(--card-bg);
    box-shadow: var(--soft-shadow);
    color: var(--label-primary);
  }
  .durable-execution-card-head,
  .durable-execution-card-foot,
  .durable-execution-progress-meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .durable-execution-card-mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-control);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .durable-execution-card-title {
    min-width: 0;
    flex: 1;
  }
  .durable-execution-card-title p {
    margin: 0 0 2px;
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
  }
  .durable-execution-card-title code { font-family: var(--font-mono); }
  .durable-execution-card-title h3 {
    overflow: hidden;
    margin: 0;
    font-size: var(--fs-label);
    line-height: var(--lh-label);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .durable-execution-status {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 6px;
    color: var(--label-secondary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    white-space: nowrap;
  }
  .durable-execution-status-dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }
  .durable-execution-card[data-status="failed"] .durable-execution-status-dot,
  .durable-execution-card[data-status="cancelled"] .durable-execution-status-dot { background: var(--danger); }
  .durable-execution-card[data-status="completed"] .durable-execution-status-dot { background: var(--online); }
  .durable-execution-card[data-status="waiting_for_user"] .durable-execution-status-dot,
  .durable-execution-card[data-status="waiting_for_approval"] .durable-execution-status-dot,
  .durable-execution-card[data-status="recovery_required"] .durable-execution-status-dot { background: var(--warning); }
  .durable-execution-progress-track {
    height: 6px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--fill);
  }
  .durable-execution-progress-track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transform-origin: left;
    transition: transform 180ms var(--ease-standard);
  }
  .durable-execution-progress-meta {
    justify-content: space-between;
    margin-top: 6px;
    color: var(--label-secondary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
  }
  .durable-execution-progress-meta span:last-child {
    overflow: hidden;
    max-width: 62%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .durable-execution-waiting {
    display: flex;
    gap: 7px;
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--warning) 10%, transparent);
    color: var(--label-secondary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
  }
  .durable-execution-waiting :global(svg) { flex: none; color: var(--warning); }
  .durable-execution-waiting strong { margin-right: 5px; color: var(--label-primary); }
  .durable-execution-card-foot {
    justify-content: space-between;
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
  }
  .durable-execution-open {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    padding: 0 7px;
    border: 0;
    border-radius: var(--radius-small);
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .durable-execution-open:hover { background: var(--accent-soft); }
  .durable-execution-open:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px var(--accent); }
  @media (max-width: 600px) {
    .durable-execution-card { margin: 12px 0; padding-inline: 12px; }
    .durable-execution-status { align-self: flex-start; }
    .durable-execution-card-head { align-items: flex-start; }
    .durable-execution-progress-meta { align-items: flex-start; flex-direction: column; gap: 3px; }
    .durable-execution-progress-meta span:last-child { max-width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .durable-execution-progress-track span { transition: none; }
  }
</style>
