<script lang="ts">
  import MoonSleep from "reicon-svelte/icons/MoonSleep";
  import Run from "reicon-svelte/icons/Run";
  import Check from "reicon-svelte/icons/Check";
  import X from "reicon-svelte/icons/X";
  import Minus from "reicon-svelte/icons/Minus";
  import CircleInfo from "reicon-svelte/icons/CircleInfo";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import type { Snippet } from "svelte";
  import AgentConversationRow from "./AgentConversationRow.svelte";
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import Button from "../components/ui/Button.svelte";
  import { emptyActionIcon, type EmptyActionIcon } from "./activityIcons";
  import type {
    DesktopAgentActivityItem,
    DesktopConversationItem,
    DesktopHandover,
    DesktopHandoverItem,
    DesktopHandoverPending
  } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { agentActivityLabel } from "./agentActivity";

  let {
    activity,
    activityReady = false,
    onActivity,
    agent,
    sessions,
    locale,
    copy,
    actions,
    onPrompt,
    onSession,
    onHistory,
    formatTime,
    composer,
    historyExpanded = false,
    onDelete,
    onCopyPath,
    onRevealInFinder,
    handover = null,
    handoverStale = false,
    handoverError = "",
    handoverBusyId = "",
    agentLabel = (id: string) => id,
    onHandoverOpen,
    onHandoverResolve,
    onHandoverAnswer,
    onHandoverPlan
  }: {
    activity?: DesktopAgentActivityItem;
    activityReady?: boolean;
    onActivity?: () => void;
    onDelete?: (item: DesktopConversationItem) => void | Promise<void>;
    onCopyPath?: (item: DesktopConversationItem) => void | Promise<void>;
    onRevealInFinder?: (item: DesktopConversationItem) => void | Promise<void>;
    composer: Snippet;
    historyExpanded?: boolean;
    agent: { enabled?: boolean; name: string; description?: string; avatar?: string | null };
    sessions: DesktopConversationItem[];
    locale: string;
    copy: Translation;
    actions: ReadonlyArray<{ icon: EmptyActionIcon; label: string; prompt: string }>;
    onPrompt: (prompt: string) => void;
    onSession: (item: DesktopConversationItem) => void | Promise<void>;
    onHistory: () => void;
    formatTime: (value: string) => string;
    /** PA-HD1–13: only the Default Agent's home receives this projection. */
    handover?: DesktopHandover | null;
    handoverStale?: boolean;
    handoverError?: string;
    handoverBusyId?: string;
    agentLabel?: (agentId: string) => string;
    onHandoverOpen?: (input: { sessionId?: string; channel?: string; title?: string; agentId?: string; planId?: string; executionId?: string }) => void;
    onHandoverResolve?: (item: DesktopHandoverPending, decision: "approve_once" | "reject") => void;
    onHandoverAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onHandoverPlan?: (item: DesktopHandoverPending, mode: "manual" | "accept_edits") => void;
  } = $props();

  let itemsExpanded = $state(false);

  const activityStatus = $derived(agent.enabled === false ? "disabled" : !activityReady ? "unknown" : activity?.status ?? "idle");
  const activityLabel = $derived(agentActivityLabel(agent.enabled !== false, activity, activityReady, copy));
  const StatusIcon = $derived(activityStatus === "working" ? Run : activityStatus === "completed" ? Check : activityStatus === "error" ? X : activityStatus === "disabled" ? Minus : activityStatus === "unknown" ? CircleInfo : MoonSleep);
  const activityTitle = $derived([agent.name, activityLabel, activityReady && activity?.status === "working" && activity.taskPreview ? activity.taskPreview : "", copy.agentViewActivity].filter(Boolean).join(" · "));

  const hasHandover = $derived(Boolean(handover));
  const showingPrevious = $derived(Boolean(handover && handover.items.length === 0 && (handover.previous?.items.length ?? 0) > 0));
  const displayItems: DesktopHandoverItem[] = $derived(handover
    ? (showingPrevious ? (handover.previous?.items ?? []) : handover.items)
    : []);
  const failedItems = $derived(displayItems.filter((item) => item.kind.endsWith("failed")));
  const completedItems = $derived(displayItems.filter((item) => !item.kind.endsWith("failed")));
  const visibleCompleted = $derived(itemsExpanded ? completedItems : []);
  const displayCounts = $derived(showingPrevious && handover?.previous ? handover.previous.counts : handover?.counts ?? { completed: 0, failed: 0, pending: 0, recovered: 0 });
  const quiet = $derived(Boolean(handover && handover.state === "quiet" && !showingPrevious));
  const firstRun = $derived(Boolean(handover && handover.state === "first-run" && !showingPrevious));
  const showHandoverBody = $derived(Boolean(handover && (handover.state !== "first-run" || showingPrevious)));
  const showHistory = $derived(!hasHandover || (handover && handover.state !== "first-run" && !quiet));
  const handoverSummary = $derived.by(() => {
    if (!handover) return "";
    if (showingPrevious) {
      return copy.handoverSummaryPrevious
        .replace("{completed}", String(displayCounts.completed))
        .replace("{pending}", String(displayCounts.pending));
    }
    if (handover.state === "quiet") return copy.handoverSummaryQuiet;
    if (displayCounts.completed === 0 && displayCounts.failed === 0) {
      return copy.handoverSummaryPendingOnly.replace("{pending}", String(displayCounts.pending));
    }
    const template = displayCounts.failed > 0 ? copy.handoverSummaryWithFailed : copy.handoverSummary;
    return template
      .replace("{completed}", String(displayCounts.completed))
      .replace("{failed}", String(displayCounts.failed))
      .replace("{pending}", String(displayCounts.pending));
  });

  function itemLabel(item: DesktopHandoverItem): string {
    if (item.title.trim()) return item.title.trim();
    return item.taskId ? copy.handoverTaskEntry : copy.handoverRunEntry;
  }

  function optionLabel(option: string): string {
    if (option === "confirm_completion") return copy.handoverOptionConfirmCompletion;
    if (option === "continue_work") return copy.handoverOptionContinueWork;
    return option;
  }

  function pendingOpens(item: DesktopHandoverPending): boolean {
    return Boolean(item.sessionId || item.planId || item.executionId);
  }
</script>

<section class="agent-home" class:has-handover={hasHandover} aria-label={agent.name}>
  <div class="agent-home-identity" class:compact={hasHandover && !firstRun}>
    {#if onActivity}
      <button type="button" class="agent-home-avatar-action" data-status={activityStatus} title={activityTitle} aria-label={activityTitle} onclick={onActivity}>
        <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
        <span class="agent-home-status-mark" aria-hidden="true"><StatusIcon size={13} /></span>
      </button>
    {:else}
      <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
    {/if}
    <h1>{agent.name}</h1>
    {#if !hasHandover || firstRun}
      <p class="agent-home-greeting">{agent.description?.trim() || (locale === "zh-CN" ? "有什么想让我帮忙的吗？" : "What can I help you with?")}</p>
    {/if}
  </div>

  {#if handoverStale}
    <p class="agent-home-handover-stale" role="status">{copy.handoverStale}</p>
  {/if}
  {#if handoverError}
    <p class="agent-home-handover-stale" data-tone="danger" role="alert">{copy.handoverActionFailed.replace("{message}", handoverError)}</p>
  {/if}

  {#if handover && showHandoverBody}
    <section class="agent-home-handover" aria-label={handover.pending.length > 0 ? copy.handoverPendingHeading : copy.handoverCompletedLabel}>
      <p class="agent-home-handover-summary" data-testid="handover-summary">{handoverSummary}</p>
      {#if displayCounts.recovered > 0 && !showingPrevious}
        <p class="agent-home-handover-note">{copy.handoverRecoveredNote.replace("{recovered}", String(displayCounts.recovered))}</p>
      {/if}

      {#if failedItems.length > 0}
        <ul class="agent-home-handover-items" aria-label={copy.handoverFailedLabel}>
          {#each failedItems as item (item.id)}
            <li class="agent-home-handover-item" data-kind={item.kind}>
              <span class="agent-home-handover-status" data-tone="danger">{copy.handoverFailedLabel}</span>
              <button type="button" class="agent-home-handover-entry" onclick={() => onHandoverOpen?.({ sessionId: item.sessionId, channel: item.channel, title: itemLabel(item), agentId: item.agentId })} disabled={!item.sessionId}>
                <span class="agent-home-handover-entry-title">{itemLabel(item)}</span>
                <span class="agent-home-handover-entry-meta">{copy.handoverFromAgent.replace("{agent}", agentLabel(item.agentId))} · {formatTime(item.occurredAt)}</span>
                {#if item.detail}<span class="agent-home-handover-entry-detail">{item.detail}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if completedItems.length > 0}
        <Button class="agent-home-handover-toggle" aria-expanded={itemsExpanded} onclick={() => (itemsExpanded = !itemsExpanded)}>
          {itemsExpanded ? copy.handoverCollapseItems : copy.handoverExpandItems.replace("{count}", String(completedItems.length))}
        </Button>
        {#if visibleCompleted.length > 0}
          <ul class="agent-home-handover-items" data-testid="handover-entries" aria-label={copy.handoverCompletedLabel}>
            {#each visibleCompleted as item (item.id)}
              <li class="agent-home-handover-item" data-kind={item.kind}>
                <span class="agent-home-handover-status" data-tone={item.kind === "task-recovered" ? "recovered" : "done"}>{item.kind === "task-recovered" ? copy.handoverRecoveredLabel : copy.handoverCompletedLabel}</span>
                <button type="button" class="agent-home-handover-entry" onclick={() => onHandoverOpen?.({ sessionId: item.sessionId, channel: item.channel, title: itemLabel(item), agentId: item.agentId })} disabled={!item.sessionId}>
                  <span class="agent-home-handover-entry-title">{itemLabel(item)}</span>
                  <span class="agent-home-handover-entry-meta">{copy.handoverFromAgent.replace("{agent}", agentLabel(item.agentId))} · {formatTime(item.occurredAt)}{item.durationMs !== undefined ? ` · ${Math.max(1, Math.round(item.durationMs / 1000))}s` : ""}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      {#if handover.pending.length > 0 && !showingPrevious}
        <div class="agent-home-handover-pending" data-testid="handover-pending">
          <h2>{copy.handoverPendingHeading}</h2>
          {#each handover.pending as item (item.id)}
            <div class="agent-home-handover-pending-item" data-kind={item.kind}>
              <div class="agent-home-handover-pending-copy">
                <span class="agent-home-handover-entry-title">{item.title || copy.handoverWaiting}</span>
                <span class="agent-home-handover-entry-meta">{copy.handoverFromAgent.replace("{agent}", agentLabel(item.agentId))}{item.sessionId ? ` · ${formatTime(item.createdAt)}` : ""}</span>
                {#if item.detail}<span class="agent-home-handover-entry-detail">{item.detail}</span>{/if}
              </div>
              <div class="agent-home-handover-pending-actions">
                {#if item.kind === "approval" && item.actionable && item.requestId}
                  <Button disabled={handoverBusyId === item.id} onclick={() => onHandoverResolve?.(item, "approve_once")}>{copy.handoverApproveOnce}</Button>
                  <Button disabled={handoverBusyId === item.id} onclick={() => onHandoverResolve?.(item, "reject")}>{copy.handoverReject}</Button>
                {:else if item.kind === "decision"}
                  {#each item.options ?? [] as option (option)}
                    <Button disabled={handoverBusyId === item.id} onclick={() => onHandoverAnswer?.(item, option)}>{optionLabel(option)}</Button>
                  {/each}
                {:else if item.kind === "plan"}
                  <Button disabled={handoverBusyId === item.id} onclick={() => onHandoverPlan?.(item, "manual")}>{copy.handoverManualMode}</Button>
                  <Button disabled={handoverBusyId === item.id} onclick={() => onHandoverPlan?.(item, "accept_edits")}>{copy.handoverAcceptEditsMode}</Button>
                {/if}
                {#if pendingOpens(item)}
                  <Button variant="icon" title={copy.handoverOpenSource} onclick={() => onHandoverOpen?.({ sessionId: item.sessionId, channel: item.channel, title: item.title, agentId: item.agentId, planId: item.planId, executionId: item.executionId })}><ArrowRight size={16} aria-hidden="true" /></Button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if handover.nextScheduled}
        <p class="agent-home-handover-next">
          {handover.nextScheduled.title
            ? copy.handoverNextScheduled.replace("{title}", handover.nextScheduled.title).replace("{time}", formatTime(handover.nextScheduled.at))
            : copy.handoverNextScheduledOnlyTime.replace("{time}", formatTime(handover.nextScheduled.at))}
        </p>
      {/if}
    </section>
  {/if}

  {@render composer()}

  {#if actions.length && (!hasHandover || firstRun)}
    <div class="agent-home-tasks" role="group" aria-label={copy.emptyChatQuickStart}>
      {#each actions as action (action.label)}
        {@const Icon = emptyActionIcon(action.icon)}
        <Button class="agent-home-task" onclick={() => onPrompt(action.prompt)}><Icon size={16} aria-hidden="true" /><span>{action.label}</span></Button>
      {/each}
    </div>
  {/if}

  {#if showHistory}
    <section class="agent-home-history" aria-labelledby="agent-home-recent-title">
      <div class="agent-home-section-heading"><h2 id="agent-home-recent-title">{locale === "zh-CN" ? (historyExpanded ? "全部对话" : "最近对话") : (historyExpanded ? "All conversations" : "Recent conversations")}</h2><Button class="agent-icon-action" title={locale === "zh-CN" ? (historyExpanded ? "收起" : "查看全部") : (historyExpanded ? "Show recent" : "View all")} onclick={onHistory}><ArrowRight size={16} aria-hidden="true" /></Button></div>
      {#if sessions.length}
        <div class="agent-history-rows">
          {#each sessions as item (item.sessionId)}
            <AgentConversationRow {item} source={item.channel} sourceLabel={item.channel === "web" ? copy.channelWeb : item.channel === "telegram" ? copy.channelTelegram : item.channel === "feishu" ? copy.channelFeishu : item.channel === "qq" ? copy.channelQq : copy.channelWeixin} {locale} {formatTime} onSelect={() => onSession(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onCopyPath={onCopyPath ? () => onCopyPath(item) : undefined} onRevealInFinder={onRevealInFinder ? () => onRevealInFinder(item) : undefined} />
          {/each}
        </div>
      {:else}
        <p class="agent-home-history-empty">{locale === "zh-CN" ? "还没有对话。从上方选择一个起点，或在下方写下你的想法。" : "No conversations yet. Choose a starting point above or write your thoughts below."}</p>
      {/if}
    </section>
  {/if}
</section>
