<script lang="ts">
  import BotAvatar from "./BotAvatar.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";

  let {
    item,
    active = false,
    statusDot = null,
    formatTime,
    labels,
    onSelect,
    onStop = undefined
  }: {
    item: DesktopConversationItem;
    active?: boolean;
    statusDot?: SessionStatusDot | null;
    formatTime: (iso: string) => string;
    labels: { running: string; waitingApproval: string; completed: string; failed: string };
    onSelect: () => void;
    onStop?: () => void;
  } = $props();

  let showStop = $derived(Boolean(onStop) && statusDot?.color === "running");
</script>

<div
  class="conversation-row"
  class:active
  data-read-only={item.readOnly}
  role="button"
  tabindex="0"
  title={item.title}
  onclick={onSelect}
  onkeydown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }}
>
  <BotAvatar botId={item.botId} name={item.botDeleted ? "" : item.botName} size={24} readOnly={item.readOnly} />
  <span class="row-main">
    <span class="row-title">{item.title}</span>
    <span class="row-time">{formatTime(item.updatedAt)}</span>
  </span>
  {#if statusDot}
    <span
      class="status-dot"
      data-color={statusDot.color}
      role="status"
      aria-label={labels[statusDot.labelKey]}
      title={labels[statusDot.labelKey]}
    ></span>
  {/if}
  {#if showStop}
    <button
      type="button"
      class="row-stop"
      aria-label={labels.running}
      title={labels.running}
      onclick={(event) => {
        event.stopPropagation();
        onStop?.();
      }}
    >
      <i class="ph-fill ph-stop" aria-hidden="true"></i>
    </button>
  {/if}
</div>

<style>
  .conversation-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .conversation-row:hover,
  .conversation-row:focus-visible {
    background: var(--fill-hover, rgba(0, 0, 0, 0.04));
  }
  .conversation-row.active {
    background: var(--fill-active, rgba(0, 107, 255, 0.1));
  }
  .conversation-row[data-read-only="true"] {
    cursor: default;
  }
  .row-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
  }
  .row-title {
    font-size: 13px;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-time {
    font-size: 11px;
    opacity: 0.6;
    white-space: nowrap;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    flex: 0 0 auto;
  }
  .status-dot[data-color="running"] {
    background: var(--accent, #006bff);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent, #006bff) 60%, transparent);
    animation: bot-status-pulse 1.6s infinite;
  }
  .status-dot[data-color="waiting"] { background: var(--warning, #ffae00); }
  .status-dot[data-color="completed"] { background: var(--success, #28a948); }
  .status-dot[data-color="failed"] { background: var(--danger, #e4106e); }
  .row-stop {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .row-stop:hover { background: var(--fill-hover, rgba(0, 0, 0, 0.06)); }
  @keyframes bot-status-pulse {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent, #006bff) 50%, transparent); }
    70% { box-shadow: 0 0 0 6px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-dot[data-color="running"] { animation: none; }
  }
</style>
