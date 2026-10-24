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
    handoverLoading = false,
    handoverStale = false,
    handoverError = "",
    handoverBusyId = "",
    agentLabel = (id: string) => id,
    onHandoverOpen,
    onHandoverResolve,
    onHandoverAnswer,
    onHandoverPlan,
    agentId = ""
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
    /** First paint of the brief: render its shape, not the empty home. */
    handoverLoading?: boolean;
    handoverStale?: boolean;
    handoverError?: string;
    handoverBusyId?: string;
    agentLabel?: (agentId: string) => string;
    onHandoverOpen?: (input: { sessionId?: string; channel?: string; title?: string; agentId?: string; planId?: string; executionId?: string }) => void;
    onHandoverResolve?: (item: DesktopHandoverPending, decision: "approve_once" | "reject") => void;
    onHandoverAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onHandoverPlan?: (item: DesktopHandoverPending, mode: "manual" | "accept_edits") => void;
    /** The Agent whose home this is; used to keep "From …" only for other sources. */
    agentId?: string;
  } = $props();

  let itemsExpanded = $state(false);
  let pendingExpanded = $state(false);
  /** Five finished rows is a glance; the rest is one click away. */
  const COMPLETED_PREVIEW = 5;
  const PENDING_PREVIEW = 3;

  const activityStatus = $derived(agent.enabled === false ? "disabled" : !activityReady ? "unknown" : activity?.status ?? "idle");
  const activityLabel = $derived(agentActivityLabel(agent.enabled !== false, activity, activityReady, copy));
  const StatusIcon = $derived(activityStatus === "working" ? Run : activityStatus === "completed" ? Check : activityStatus === "error" ? X : activityStatus === "disabled" ? Minus : activityStatus === "unknown" ? CircleInfo : MoonSleep);
  const activityTitle = $derived([agent.name, activityLabel, activityReady && activity?.status === "working" && activity.taskPreview ? activity.taskPreview : "", copy.agentViewActivity].filter(Boolean).join(" · "));

  const hasHandover = $derived(Boolean(handover));
  const loadingHandover = $derived(Boolean(handoverLoading && !handover));
  const showingPrevious = $derived(Boolean(handover && handover.items.length === 0 && (handover.previous?.items.length ?? 0) > 0));
  const displayItems: DesktopHandoverItem[] = $derived(handover
    ? (showingPrevious ? (handover.previous?.items ?? []) : handover.items)
    : []);
  const failedItems = $derived(displayItems.filter((item) => item.kind.endsWith("failed")));
  const completedItems = $derived(displayItems.filter((item) => !item.kind.endsWith("failed")));
  const visibleCompleted = $derived(itemsExpanded ? completedItems : completedItems.slice(0, COMPLETED_PREVIEW));
  const hiddenCompleted = $derived(Math.max(0, completedItems.length - COMPLETED_PREVIEW));
  const visiblePending: DesktopHandoverPending[] = $derived(pendingExpanded
    ? (handover?.pending ?? [])
    : (handover?.pending ?? []).slice(0, PENDING_PREVIEW));
  const hiddenPending = $derived(Math.max(0, (handover?.pending.length ?? 0) - PENDING_PREVIEW));
  const displayCounts = $derived(showingPrevious && handover?.previous ? handover.previous.counts : handover?.counts ?? { completed: 0, failed: 0, pending: 0, recovered: 0 });
  const quiet = $derived(Boolean(handover && handover.state === "quiet" && !showingPrevious));
  const firstRun = $derived(Boolean(handover && handover.state === "first-run" && !showingPrevious));
  const showHandoverBody = $derived(Boolean(handover && (handover.state !== "first-run" || showingPrevious)));
  const showHistory = $derived(!loadingHandover && (!hasHandover || (handover && handover.state !== "first-run" && !quiet)));
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
    const template = displayCounts.pending === 0
      ? (displayCounts.failed > 0 ? copy.handoverSummaryDone : copy.handoverSummaryDoneOnly)
      : displayCounts.failed > 0 ? copy.handoverSummaryWithFailed : copy.handoverSummary;
    return template
      .replace("{completed}", String(displayCounts.completed))
      .replace("{failed}", String(displayCounts.failed))
      .replace("{pending}", String(displayCounts.pending));
  });

  function itemLabel(item: DesktopHandoverItem): string {
    if (item.title.trim()) return item.title.trim();
    return item.taskId ? copy.handoverTaskEntry : copy.handoverRunEntry;
  }

  /** The machine reason, phrased by the page; `detail` stays the diagnostic. */
  function failureHeadline(item: DesktopHandoverItem): string {
    switch (item.detailCode) {
      case "model_auth": return copy.handoverDetailModelAuth;
      case "model_missing": return copy.handoverDetailModelMissing;
      case "account_balance": return copy.handoverDetailAccountBalance;
      case "run_budget": return copy.handoverDetailRunBudget;
      default: return "";
    }
  }

  /** Source is only worth a line when it is not the Agent whose home this is. */
  function itemMeta(item: DesktopHandoverItem): string {
    const parts: string[] = [];
    if (item.agentId && item.agentId !== agentId) parts.push(copy.handoverFromAgent.replace("{agent}", agentLabel(item.agentId)));
    parts.push(formatTime(item.occurredAt));
    if (item.durationMs !== undefined) parts.push(`${Math.max(1, Math.round(item.durationMs / 1000))}s`);
    return parts.join(" · ");
  }

  function pendingMeta(item: DesktopHandoverPending): string {
    const parts: string[] = [];
    const reason = pendingReason(item);
    if (reason) parts.push(reason);
    if (item.agentId && item.agentId !== agentId) parts.push(copy.handoverFromAgent.replace("{agent}", agentLabel(item.agentId)));
    if (item.sessionId) parts.push(formatTime(item.createdAt));
    return parts.join(" · ");
  }

  function pendingReason(item: DesktopHandoverPending): string {
    if (item.waitKind === "approval") return copy.handoverWaitApproval;
    if (item.waitKind === "recovery") return copy.handoverWaitRecovery;
    return "";
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

<section class="agent-home" class:has-handover={hasHandover || loadingHandover} aria-label={agent.name}>
  <div class="agent-home-identity" class:compact={(hasHandover && !firstRun) || loadingHandover}>
    {#if onActivity}
      <button type="button" class="agent-home-avatar-action" data-status={activityStatus} title={activityTitle} aria-label={activityTitle} onclick={onActivity}>
        <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
        <span class="agent-home-status-mark" aria-hidden="true"><StatusIcon size={13} /></span>
      </button>
    {:else}
      <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
    {/if}
    <h1>{agent.name}</h1>
    {#if (!hasHandover || firstRun) && !loadingHandover}
      <p class="agent-home-greeting">{agent.description?.trim() || (locale === "zh-CN" ? "有什么想让我帮忙的吗？" : "What can I help you with?")}</p>
    {/if}
  </div>

  {#if handoverStale}
    <p class="agent-home-handover-stale" role="status">{copy.handoverStale}</p>
  {/if}
  {#if handoverError}
    <p class="agent-home-handover-stale" data-tone="danger" role="alert">{copy.handoverActionFailed.replace("{message}", handoverError)}</p>
  {/if}

  {#if loadingHandover}
    <div class="skeleton-rows agent-home-handover-skeleton" aria-hidden="true">
      <div class="skeleton-row"><span></span><i></i></div>
      <div class="skeleton-row"><span></span><i></i></div>
      <div class="skeleton-row"><span></span><i></i></div>
    </div>
  {/if}

  {#if handover && showHandoverBody}
    <section class="agent-home-handover" aria-label={handover.pending.length > 0 ? copy.handoverPendingHeading : copy.handoverCompletedLabel}>
      <p class="agent-home-handover-summary" data-testid="handover-summary">{handoverSummary}</p>
      {#if displayCounts.recovered > 0 && !showingPrevious}
        <p class="agent-home-handover-note">{copy.handoverRecoveredNote.replace("{recovered}", String(displayCounts.recovered))}</p>
      {/if}

      {#if failedItems.length > 0}
        <div class="agent-home-handover-section">
          <h2 class="agent-home-handover-heading">{copy.handoverFailedLabel}<span>{failedItems.length}</span></h2>
          <ul class="agent-home-handover-list" aria-label={copy.handoverFailedLabel}>
            {#each failedItems as item (item.id)}
              <li class="agent-home-handover-row" data-kind={item.kind}>
                <button type="button" class="agent-home-handover-entry" onclick={() => onHandoverOpen?.({ sessionId: item.sessionId, channel: item.channel, title: itemLabel(item), agentId: item.agentId })} disabled={!item.sessionId}>
                  <span class="agent-home-handover-entry-title">{itemLabel(item)}</span>
                  <span class="agent-home-handover-entry-meta">{itemMeta(item)}</span>
                  {#if failureHeadline(item)}<span class="agent-home-handover-entry-reason">{failureHeadline(item)}</span>{/if}
                  {#if item.detail}<span class="agent-home-handover-entry-detail" title={item.detail}>{item.detail}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if handover.pending.length > 0 && !showingPrevious}
        <div class="agent-home-handover-section" data-testid="handover-pending">
          <h2 class="agent-home-handover-heading">{copy.handoverPendingHeading}<span>{handover.pending.length}</span></h2>
          <ul class="agent-home-handover-list">
            {#each visiblePending as item (item.id)}
              <li class="agent-home-handover-row is-pending" data-kind={item.kind}>
                <div class="agent-home-handover-row-copy">
                  <span class="agent-home-handover-entry-title">{item.title || copy.handoverPendingRun}</span>
                  <span class="agent-home-handover-entry-meta">{pendingMeta(item)}</span>
                  {#if item.detail}<span class="agent-home-handover-entry-detail" title={item.detail}>{item.detail}</span>{/if}
                </div>
                <div class="agent-home-handover-row-actions">
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
              </li>
            {/each}
          </ul>
          {#if hiddenPending > 0}
            <button type="button" class="agent-home-handover-more" aria-expanded={pendingExpanded} onclick={() => (pendingExpanded = !pendingExpanded)}>
              {pendingExpanded ? copy.handoverCollapseItems : copy.handoverShowMorePending.replace("{count}", String(hiddenPending))}
            </button>
          {/if}
        </div>
      {/if}

      {#if completedItems.length > 0}
        <div class="agent-home-handover-section">
          <h2 class="agent-home-handover-heading">{copy.handoverCompletedLabel}<span>{completedItems.length}</span></h2>
          {#if visibleCompleted.length > 0}
            <ul class="agent-home-handover-list" data-testid="handover-entries" aria-label={copy.handoverCompletedLabel}>
              {#each visibleCompleted as item (item.id)}
                <li class="agent-home-handover-row" data-kind={item.kind}>
                  <button type="button" class="agent-home-handover-entry" onclick={() => onHandoverOpen?.({ sessionId: item.sessionId, channel: item.channel, title: itemLabel(item), agentId: item.agentId })} disabled={!item.sessionId}>
                    <span class="agent-home-handover-entry-title">{itemLabel(item)}{#if item.kind === "task-recovered"}<span class="agent-home-handover-chip">{copy.handoverRecoveredLabel}</span>{/if}</span>
                    <span class="agent-home-handover-entry-meta">{itemMeta(item)}</span>
                    {#if item.resultPreview}<span class="agent-home-handover-entry-detail" title={item.resultPreview}>{item.resultPreview}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if hiddenCompleted > 0}
            <button type="button" class="agent-home-handover-more" aria-expanded={itemsExpanded} onclick={() => (itemsExpanded = !itemsExpanded)}>
              {itemsExpanded ? copy.handoverCollapseItems : copy.handoverExpandItems.replace("{count}", String(completedItems.length))}
            </button>
          {/if}
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

  {#if actions.length && (!hasHandover || firstRun) && !loadingHandover}
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
