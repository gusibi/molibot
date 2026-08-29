<script lang="ts">
  import type { DesktopDurableExecutionItem, DesktopDurableExecutionStatus } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  export let items: DesktopDurableExecutionItem[] = [];
  export let copy: Translation;
  export let onOpen: (executionId: string) => void;

  const terminalStatuses = new Set<DesktopDurableExecutionStatus>(["partial", "completed", "failed", "cancelled"]);
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

  $: visibleItems = items.filter((item) => !terminalStatuses.has(item.execution.status)).slice(0, 8);
  $: countLabel = visibleItems.length > 99 ? "99+" : String(visibleItems.length);
</script>

{#if visibleItems.length > 0}
  <section class="durable-sidebar-section">
    <div class="durable-sidebar-heading">
      <span>{copy.durableInProgress}</span>
      <span class="durable-sidebar-count">{countLabel}</span>
    </div>
    <div class="durable-sidebar-list">
      {#each visibleItems as item (item.execution.id)}
        <button
          type="button"
          class="durable-sidebar-row"
          data-status={item.execution.status}
          onclick={() => onOpen(item.execution.id)}
          aria-label={item.execution.shortHandle + " " + item.execution.goal}
        >
          <span class="durable-sidebar-mark" aria-hidden="true"><i class="ph ph-stack-simple" aria-hidden="true"></i></span>
          <span class="durable-sidebar-copy">
            <strong>{item.execution.goal}</strong>
            <small>{item.execution.shortHandle} · {copy[statusKeys[item.execution.status]]}{item.projection.queuePosition !== undefined ? ` · ${copy.durableQueueAhead.replace("{count}", String(Math.max(0, item.projection.queuePosition - 1)))}` : ""}</small>
          </span>
          <i class="ph ph-caret-right durable-sidebar-arrow" aria-hidden="true"></i>
        </button>
      {/each}
    </div>
  </section>
{/if}

<style>
  .durable-sidebar-section { display: grid; gap: 4px; padding: 0 0 8px; }
  .durable-sidebar-heading {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 32px;
    padding: 0 8px;
    color: var(--label-secondary);
    font-size: var(--fs-meta);
    font-weight: 600;
    letter-spacing: var(--tracking-normal);
  }
  .durable-sidebar-count {
    display: inline-flex;
    min-width: 18px;
    height: 18px;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-meta);
    font-variant-numeric: tabular-nums;
  }
  .durable-sidebar-list { display: grid; gap: 2px; }
  .durable-sidebar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 38px;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--rounded-sm);
    background: transparent;
    color: var(--label-primary);
    text-align: left;
    cursor: pointer;
  }
  .durable-sidebar-row:hover { background: var(--fill); }
  .durable-sidebar-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
  .durable-sidebar-mark {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-small);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--icon-sm);
  }
  .durable-sidebar-row[data-status="waiting_for_user"] .durable-sidebar-mark,
  .durable-sidebar-row[data-status="waiting_for_approval"] .durable-sidebar-mark,
  .durable-sidebar-row[data-status="recovery_required"] .durable-sidebar-mark { background: color-mix(in srgb, var(--warning) 12%, transparent); color: var(--warning); }
  .durable-sidebar-copy { display: grid; min-width: 0; flex: 1; gap: 1px; }
  .durable-sidebar-copy strong,
  .durable-sidebar-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .durable-sidebar-copy strong { font-size: var(--fs-meta); font-weight: 600; line-height: var(--lh-meta); }
  .durable-sidebar-copy small { color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-sidebar-arrow { flex: none; color: var(--label-tertiary); font-size: var(--icon-xs); }
</style>
