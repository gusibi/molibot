<script lang="ts">
  import ChatDots from "reicon-svelte/icons/ChatDots";
  import CalendarCheck from "reicon-svelte/icons/CalendarCheck";
  import { CHANNEL_LOGOS } from "./activityIcons";
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

  let wideDashboard = $state(false);

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
    /** PA-HD1–14: only the Default Agent's home receives this projection. */
    handover?: DesktopHandover | null;
    /** First paint of the brief: render its shape, not the empty home. */
    handoverLoading?: boolean;
    handoverStale?: boolean;
    handoverError?: string;
    handoverBusyId?: string;
    agentLabel?: (agentId: string) => string;
    onHandoverOpen?: (input: { sessionId?: string; channel?: string; title?: string; agentId?: string; planId?: string; executionId?: string }) => void | Promise<void>;
    onHandoverResolve?: (items: DesktopHandoverPending[], decision: "approve_once" | "reject") => void;
    onHandoverAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onHandoverPlan?: (item: DesktopHandoverPending, mode: "manual" | "accept_edits") => void;
    /** The Agent whose home this is; used to keep "From …" only for other sources. */
    agentId?: string;
  } = $props();

  let itemsExpanded = $state(false);
  let pendingExpanded = $state(false);
  let executionsExpanded = $state(false);
  /** The hero plus three compact rows is a glance; the rest is one click away. */
  const RESULT_PREVIEW = 3;
  const PENDING_PREVIEW = 3;

  const activityStatus = $derived(agent.enabled === false ? "disabled" : !activityReady ? "unknown" : activity?.status ?? "idle");
  const activityLabel = $derived(agentActivityLabel(agent.enabled !== false, activity, activityReady, copy));
  const StatusIcon = $derived(activityStatus === "working" ? Run : activityStatus === "completed" ? Check : activityStatus === "error" ? X : activityStatus === "disabled" ? Minus : activityStatus === "unknown" ? CircleInfo : MoonSleep);
  const activityTitle = $derived([agent.name, activityLabel, activityReady && activity?.status === "working" && activity.taskPreview ? activity.taskPreview : "", copy.agentViewActivity].filter(Boolean).join(" · "));

  const loadingHandover = $derived(Boolean(handoverLoading && !handover));
  const showingPrevious = $derived(Boolean(handover && handover.items.length === 0 && (handover.previous?.items.length ?? 0) > 0));
  const displayItems: DesktopHandoverItem[] = $derived(handover
    ? (showingPrevious ? (handover.previous?.items ?? []) : handover.items)
    : []);
  const visibleExecutions = $derived(executionsExpanded ? displayItems : displayItems.slice(0, 5));
  const failedItems = $derived(displayItems.filter((item) => item.kind.endsWith("failed")));
  const completedItems = $derived(displayItems.filter((item) => !item.kind.endsWith("failed")));
  const heroItem = $derived(completedItems[0] ?? null);
  const restItems = $derived(completedItems.slice(1));
  const visibleRest = $derived(itemsExpanded ? restItems : restItems.slice(0, RESULT_PREVIEW));
  const hiddenRest = $derived(Math.max(0, restItems.length - RESULT_PREVIEW));
  const visiblePending: DesktopHandoverPending[] = $derived(pendingExpanded
    ? (handover?.pending ?? [])
    : (handover?.pending ?? []).slice(0, PENDING_PREVIEW));
  const hiddenPending = $derived(Math.max(0, (handover?.pending.length ?? 0) - PENDING_PREVIEW));

  const displayCounts = $derived(showingPrevious && handover?.previous ? handover.previous.counts : handover?.counts ?? { completed: 0, failed: 0, pending: 0, recovered: 0 });
  const crossChannel = $derived(handover?.crossChannel);
  const crossChannelMeta = $derived(crossChannel
    ? [
        crossChannel.channels.map(channelLabel).join(locale === "zh-CN" ? "、" : ", "),
        formatTime(crossChannel.latestAt)
      ].filter(Boolean).join(" · ")
    : "");

  /**
   * A quiet day is not a briefing. With nothing to report the page is the same
   * start form every other Agent uses; only a live generation or the frozen
   * previous one earns the handover layout.
   */
  const showHandover = $derived(Boolean(handover && (handover.state === "active" || showingPrevious)));
  const liveRun = $derived(activity?.status === "working" ? activity : null);
  const liveElapsed = $derived.by(() => {
    if (!liveRun) return "";
    const started = Date.parse(String(liveRun.startedAt ?? ""));
    return Number.isFinite(started) ? elapsedLabel(Date.now() - started) : "";
  });
  const liveMeta = $derived.by(() => {
    if (!liveRun) return "";
    const parts = [liveElapsed];
    if (liveRun.subagents?.length) parts.push(copy.handoverSubagents.replace("{count}", String(liveRun.subagents.length)));
    if (liveRun.channel) parts.push(channelLabel(liveRun.channel));
    return parts.filter(Boolean).join(" · ");
  });
  const windowLabel = $derived.by(() => {
    if (!handover) return "";
    const now = formatTime(handover.generatedAt);
    if (!handover.lastAcknowledgedAt) return copy.handoverGenerated.replace("{now}", now);
    return copy.handoverWindow
      .replace("{left}", formatTime(handover.lastAcknowledgedAt))
      .replace("{now}", now);
  });

  const handoverSummary = $derived.by(() => {
    if (!handover) return "";
    if (showingPrevious) {
      return copy.handoverSummaryPrevious
        .replace("{completed}", String(displayCounts.completed))
        .replace("{pending}", String(displayCounts.pending));
    }
    if (displayCounts.completed === 0 && displayCounts.failed === 0 && displayCounts.pending === 0) {
      return crossChannel ? copy.handoverSummaryCrossOnly : "";
    }
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

  function elapsedLabel(ms: number): string {
    if (!Number.isFinite(ms) || ms < 60_000) {
      return copy.handoverElapsedSeconds.replace("{count}", String(Math.max(1, Math.round(ms / 1000))));
    }
    if (ms < 3_600_000) {
      return copy.handoverElapsedMinutes.replace("{count}", String(Math.max(1, Math.round(ms / 60_000))));
    }
    return copy.handoverElapsedHours.replace("{count}", String(Math.max(1, Math.round(ms / 3_600_000))));
  }

  function itemLabel(item: DesktopHandoverItem): string {
    if (item.title.trim()) return item.title.trim();
    return item.taskId ? copy.handoverTaskEntry : copy.handoverRunEntry;
  }

  function heroChip(item: DesktopHandoverItem): string {
    return item.taskId ? copy.handoverKindTask : copy.handoverResult;
  }

  function channelLabel(channel: string): string {
    if (channel === "feishu") return copy.channelFeishu;
    if (channel === "weixin") return copy.channelWeixin;
    if (channel === "telegram") return copy.channelTelegram;
    if (channel === "qq") return copy.channelQq;
    if (channel === "web") return copy.channelWeb;
    return channel;
  }

  function openItem(item: DesktopHandoverItem): void {
    onHandoverOpen?.({
      sessionId: item.sessionId,
      channel: item.channel,
      title: itemLabel(item),
      agentId: item.agentId
    });
  }

  function openPending(item: DesktopHandoverPending): void {
    onHandoverOpen?.({
      sessionId: item.sessionId,
      channel: item.channel,
      title: item.title,
      agentId: item.agentId,
      planId: item.planId,
      executionId: item.executionId
    });
  }

  /**
   * Arrow keys move between cards, so the brief can be read without leaving the
   * keyboard; focus also unclips a failure diagnostic (CSS `:focus-within`).
   */
  function handoverKeys(node: HTMLElement) {
    const handler = (event: KeyboardEvent) => moveHandoverFocus(event);
    node.addEventListener("keydown", handler);
    return {
      destroy() {
        node.removeEventListener("keydown", handler);
      }
    };
  }

  function moveHandoverFocus(event: KeyboardEvent): void {
    const direction = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!direction) return;
    const section = (event.target as HTMLElement | null)?.closest(".agent-home--brief");
    if (!section) return;
    const rows = Array.from(section.querySelectorAll<HTMLElement>("[data-handover-row]"));
    const current = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-handover-row]");
    const index = current ? rows.indexOf(current) : -1;
    if (index < 0) return;
    const next = rows[index + direction];
    if (!next) return;
    const target = next.matches("button:not(:disabled), [href], [tabindex='0']")
      ? next
      : next.querySelector<HTMLElement>("button:not(:disabled), [href], [tabindex='0']");
    if (!target) return;
    event.preventDefault();
    target.focus();
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
  function itemMeta(item: DesktopHandoverItem, includeTime = true): string {
    const parts: string[] = [];
    if (item.agentId && item.agentId !== agentId) parts.push(copy.handoverFromAgent.replace("{agent}", agentLabel(item.agentId)));
    if (includeTime) parts.push(formatTime(item.occurredAt));
    if (item.durationMs !== undefined) parts.push(copy.handoverDuration.replace("{duration}", elapsedLabel(item.durationMs)));
    return parts.join(" · ");
  }

  function pendingMeta(item: DesktopHandoverPending): string {
    const parts: string[] = [];
    const reason = pendingReason(item);
    if (reason) parts.push(reason);
    if (item.agentId && item.agentId !== agentId) parts.push(copy.handoverFromAgent.replace("{agent}", agentLabel(item.agentId)));
    return parts.join(" · ");
  }

  function pendingReason(item: DesktopHandoverPending): string {
    if (item.waitKind === "approval") return copy.handoverWaitApproval;
    if (item.waitKind === "recovery") return copy.handoverWaitRecovery;
    return "";
  }

  function pendingKindLabel(item: DesktopHandoverPending): string {
    if (item.kind === "approval") return copy.handoverKindApproval;
    if (item.kind === "decision") return copy.handoverKindDecision;
    if (item.kind === "plan") return copy.handoverKindPlan;
    return copy.handoverKindRun;
  }

  function optionLabel(option: string): string {
    if (option === "confirm_completion") return copy.handoverOptionConfirmCompletion;
    if (option === "continue_work") return copy.handoverOptionContinueWork;
    return option;
  }

  function measureDashboard(node: HTMLElement) {
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      // Reordering the sections can change height; publish after observer delivery.
      frame = requestAnimationFrame(() => { wideDashboard = entry.contentRect.width >= 960; });
    });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
        cancelAnimationFrame(frame);
      }
    };
  }

  function pendingOpens(item: DesktopHandoverPending): boolean {
    return Boolean(item.sessionId || item.planId || item.executionId);
  }
</script>

{#snippet recentConversations(showEmpty: boolean)}
  <section class="agent-home-history" aria-labelledby="agent-home-recent-title">
    <div class="agent-home-section-heading">
      <h2 id="agent-home-recent-title">{locale === "zh-CN" ? (historyExpanded ? "全部对话" : "最近对话") : (historyExpanded ? "All conversations" : "Recent conversations")}</h2>
      <button type="button" class="agent-home-section-link" onclick={onHistory}>
        {locale === "zh-CN" ? (historyExpanded ? "收起" : "查看全部") : (historyExpanded ? "Show recent" : "View all")}
        <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
    {#if sessions.length}
      <div class="agent-history-rows agent-home-recent">
        {#each sessions as item (item.sessionId)}
          <AgentConversationRow {item} source={item.channel} sourceLabel={item.channel === "web" ? copy.channelWeb : item.channel === "telegram" ? copy.channelTelegram : item.channel === "feishu" ? copy.channelFeishu : item.channel === "qq" ? copy.channelQq : copy.channelWeixin} {locale} {formatTime} showSource onSelect={() => onSession(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onCopyPath={onCopyPath ? () => onCopyPath(item) : undefined} onRevealInFinder={onRevealInFinder ? () => onRevealInFinder(item) : undefined} />
        {/each}
      </div>
    {:else if showEmpty}
      <p class="agent-home-history-empty">{locale === "zh-CN" ? "还没有对话。从上方选择一个起点，或在下方写下你的想法。" : "No conversations yet. Choose a starting point above or write your thoughts below."}</p>
    {/if}
  </section>
{/snippet}

{#snippet resultsSection()}
    {#if heroItem}
      <section class="agent-home-band agent-home-results" aria-labelledby="home-results-title">
        <div class="agent-home-band-head">
          <h2 class="agent-home-band-label" id="home-results-title">{copy.handoverBandResults}</h2>
          <span class="agent-home-band-count">{completedItems.length}</span>
        </div>
        <div data-testid="handover-entries">
          <article class="agent-home-hero" data-handover-row>
            <div class="agent-home-card-head">
              <span class="agent-home-delivery-label"><Check size={14} aria-hidden="true" />{heroChip(heroItem)}</span>
              {#if heroItem.kind === "task-recovered"}<span class="agent-home-chip">{copy.handoverRecoveredLabel}</span>{/if}
              <time datetime={heroItem.occurredAt}>{formatTime(heroItem.occurredAt)}</time>
            </div>
            <h3 class="agent-home-hero-title">{itemLabel(heroItem)}</h3>
            {#if heroItem.resultPreview}<p class="agent-home-hero-preview">{heroItem.resultPreview}</p>{/if}
            <div class="agent-home-card-foot">
              <span class="agent-home-meta">{itemMeta(heroItem, false)}</span>
              <Button variant="primary" disabled={!heroItem.sessionId} onclick={() => openItem(heroItem)}>{copy.handoverOpenSource}<ArrowRight size={14} aria-hidden="true" /></Button>
            </div>
          </article>

          {#if visibleRest.length > 0}
            <div class="agent-home-rows">
              {#each visibleRest as item (item.id)}
                <button type="button" class="agent-home-row" data-handover-row onclick={() => openItem(item)} disabled={!item.sessionId}>
                  <span class="agent-home-row-title">{itemLabel(item)}{#if item.kind === "task-recovered"}<span class="agent-home-chip tiny">{copy.handoverRecoveredLabel}</span>{/if}</span>
                  {#if item.resultPreview}<span class="agent-home-row-preview">{item.resultPreview}</span>{/if}
                  <span class="agent-home-meta">{itemMeta(item)}</span>
                  <ArrowRight size={16} class="agent-home-row-arrow" aria-hidden="true" />
                </button>
              {/each}
            </div>
          {/if}

          {#if hiddenRest > 0}
            <button type="button" class="agent-home-more" aria-expanded={itemsExpanded} onclick={() => (itemsExpanded = !itemsExpanded)}>
              {itemsExpanded ? copy.handoverCollapseItems : copy.handoverShowMoreResults.replace("{count}", String(hiddenRest))}
            </button>
          {/if}
        </div>
      </section>
    {/if}

{/snippet}

{#snippet decisionsSection()}
    {#if (handover?.pending.length ?? 0) > 0}
      <section class="agent-home-band agent-home-decisions" aria-labelledby="home-decisions-title" data-testid="handover-pending">
        <div class="agent-home-band-head">
          <h2 class="agent-home-band-label" id="home-decisions-title">{copy.handoverPendingHeading}</h2>
          <span class="agent-home-band-count">{(handover?.pending.length ?? 0)}</span>
        </div>
        <div class="agent-home-cards">
          {#each visiblePending as item (item.id)}
            {@const meta = pendingMeta(item)}
            <article class="agent-home-card" data-handover-row data-kind={item.kind}>
              <div class="agent-home-card-head">
                <span class="agent-home-chip" class:warn={item.kind === "approval"}>{pendingKindLabel(item)}</span>
                <time datetime={item.createdAt}>{formatTime(item.createdAt)}</time>
              </div>
              {#if pendingOpens(item)}
                <button type="button" class="agent-home-card-title" onclick={() => openPending(item)}>{item.title || copy.handoverPendingRun}</button>
              {:else}
                <h3>{item.title || copy.handoverPendingRun}</h3>
              {/if}
              {#if meta}<p class="agent-home-card-meta">{meta}</p>{/if}
              {#if item.detail}
                {#if item.kind === "approval"}
                  <details class="agent-home-command"><summary>{copy.handoverCommandDetails}</summary><pre class="agent-home-cmd">{item.detail}</pre></details>
                {:else}
                  <p class="agent-home-card-body">{item.detail}</p>
                {/if}
              {/if}
              {#if item.kind === "approval" && item.actionable && item.requestId}
                <div class="agent-home-card-actions">
                  <Button variant="primary" disabled={handoverStale || handoverBusyId === item.id} onclick={() => onHandoverResolve?.([item], "approve_once")}>{copy.handoverApproveOnce}</Button>
                  <Button disabled={handoverStale || handoverBusyId === item.id} onclick={() => onHandoverResolve?.([item], "reject")}>{copy.handoverReject}</Button>
                </div>
              {:else if item.kind === "decision"}
                <div class="agent-home-card-actions">
                  {#each item.options ?? [] as option (option)}
                    <Button disabled={handoverStale || handoverBusyId === item.id} onclick={() => onHandoverAnswer?.(item, option)}>{optionLabel(option)}</Button>
                  {/each}
                </div>
              {:else if item.kind === "plan"}
                <div class="agent-home-card-actions">
                  <Button disabled={handoverStale || handoverBusyId === item.id} onclick={() => onHandoverPlan?.(item, "manual")}>{copy.handoverManualMode}</Button>
                  <Button disabled={handoverStale || handoverBusyId === item.id} onclick={() => onHandoverPlan?.(item, "accept_edits")}>{copy.handoverAcceptEditsMode}</Button>
                </div>
              {/if}
            </article>
          {/each}
        </div>
        {#if hiddenPending > 0}
          <button type="button" class="agent-home-more" aria-expanded={pendingExpanded} onclick={() => (pendingExpanded = !pendingExpanded)}>
            {pendingExpanded ? copy.handoverCollapseItems : copy.handoverShowMorePending.replace("{count}", String(hiddenPending))}
          </button>
        {/if}
      </section>
    {/if}

{/snippet}

{#if loadingHandover}
  <section class="agent-home agent-home--brief" aria-label={agent.name} aria-busy="true">
    <header class="agent-home-head">
      <div class="agent-home-head-who">
        <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
        <div class="agent-home-head-copy">
          <span class="agent-home-head-name">{agent.name}</span>
          <span class="agent-home-head-state">{copy.loading}</span>
        </div>
      </div>
    </header>
    <div class="agent-home-dashboard agent-home-dashboard--loading" aria-hidden="true">
      <div class="skeleton-rows agent-home-handover-skeleton"><div class="skeleton-row"><span></span><i></i></div><div class="skeleton-row"><span></span><i></i></div><div class="skeleton-row"><span></span><i></i></div></div>
      <div class="skeleton-rows agent-home-handover-skeleton"><div class="skeleton-row"><span></span><i></i></div><div class="skeleton-row"><span></span><i></i></div></div>
    </div>
    {@render composer()}
  </section>
{:else if showHandover && handover}
  <section class="agent-home agent-home--brief" class:agent-home--quiet-brief={displayItems.length === 0 && handover.pending.length === 0} aria-label={agent.name} use:handoverKeys>
    <header class="agent-home-head">
      <div class="agent-home-head-who">
        {#if onActivity}
          <button type="button" class="agent-home-avatar-action" data-status={activityStatus} title={activityTitle} aria-label={activityTitle} onclick={onActivity}>
            <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
            <span class="agent-home-status-mark" aria-hidden="true"><StatusIcon size={12} /></span>
          </button>
        {:else}
          <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
        {/if}
        <div class="agent-home-head-copy">
          <h1 class="agent-home-head-name">{agent.name}</h1>
          <span class="agent-home-head-state">{activityLabel}</span>
        </div>
      </div>
      <div class="agent-home-head-when">
        <span>{windowLabel}</span>
      </div>
    </header>

    {#if handoverStale}
      <p class="agent-home-handover-stale" role="status">{copy.handoverStale}</p>
    {/if}
    {#if handoverError}
      <p class="agent-home-handover-stale" data-tone="danger" role="alert">{copy.handoverActionFailed.replace("{message}", handoverError)}</p>
    {/if}

    {#if liveRun}
      <div class="agent-home-live">
        <span class="agent-home-live-dot" aria-hidden="true"></span>
        <span class="agent-home-live-title">{liveRun.taskPreview || copy.handoverLive}</span>
        <span class="agent-home-live-meta">{liveMeta}</span>
        {#if onActivity}
          <button type="button" class="agent-home-more" onclick={onActivity}>{copy.handoverOpenActivity}</button>
        {/if}
      </div>
    {/if}

    <p class="agent-home-lede" data-testid="handover-summary">{handoverSummary}</p>

    <div class="agent-home-dashboard" class:has-results={Boolean(heroItem)} class:has-decisions={Boolean(handover.pending.length)} use:measureDashboard>
      {#if wideDashboard}
        {@render resultsSection()}
        {@render decisionsSection()}
      {:else}
        {@render decisionsSection()}
        {@render resultsSection()}
      {/if}
    </div>

    {#if displayItems.length > 0}
      <section class="agent-home-band agent-home-executions" aria-labelledby="home-executions-title">
        <div class="agent-home-band-head">
          <h2 class="agent-home-band-label" id="home-executions-title">{copy.handoverExecutions}</h2>
        </div>
        <table class="agent-home-execution-table" aria-label={copy.handoverExecutions}>
          <thead><tr><th scope="col">{copy.handoverExecutionTask}</th><th scope="col">{copy.handoverExecutionState}</th><th scope="col">{copy.handoverExecutionTime}</th><th scope="col">{copy.handoverExecutionSource}</th></tr></thead>
          <tbody>
            {#each visibleExecutions as item (item.id)}
              <tr>
                <th scope="row">{itemLabel(item)}</th>
                <td data-label={copy.handoverExecutionState}><span class="agent-home-execution-state" data-failed={item.kind.endsWith("failed")}><span aria-hidden="true">{item.kind.endsWith("failed") ? "×" : "✓"}</span>{item.kind.endsWith("failed") ? copy.handoverFailedLabel : item.kind === "task-recovered" ? copy.handoverRecoveredLabel : copy.handoverCompletedLabel}</span></td>
                <td data-label={copy.handoverExecutionTime}><time datetime={item.occurredAt}>{formatTime(item.occurredAt)}</time></td>
                <td data-label={copy.handoverExecutionSource}><Button variant="icon" title={`${copy.handoverOpenSource}: ${itemLabel(item)}`} disabled={!item.sessionId} onclick={() => openItem(item)}><ArrowRight size={16} aria-hidden="true" /></Button></td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if displayItems.length > 5}
          <Button aria-expanded={executionsExpanded} onclick={() => (executionsExpanded = !executionsExpanded)}>{executionsExpanded ? copy.handoverCollapseItems : copy.handoverShowExecutions.replace("{count}", String(displayItems.length - 5))}</Button>
        {/if}
      </section>
    {/if}

    {#if failedItems.length > 0}
      <section class="agent-home-band agent-home-failures" aria-label={copy.handoverFailedLabel}>
        <div class="agent-home-band-head">
          <span class="agent-home-band-label">{copy.handoverFailedLabel}</span>
          <span class="agent-home-band-count">{failedItems.length}</span>
        </div>
        <div class="agent-home-cards">
          {#each failedItems as item (item.id)}
            <article class="agent-home-failure" data-handover-row data-kind={item.kind}>
              <div class="agent-home-card-head">
                <span class="agent-home-chip danger">{item.taskId ? copy.handoverTaskEntry : copy.handoverRunEntry}</span>
                <time>{formatTime(item.occurredAt)}</time>
              </div>
              <h3>{itemLabel(item)}</h3>
              {#if failureHeadline(item)}<p class="agent-home-failure-reason">{failureHeadline(item)}</p>{/if}
              {#if item.detail}<pre class="agent-home-failure-detail">{item.detail}</pre>{/if}
              <div class="agent-home-card-foot">
                <span class="agent-home-meta">{itemMeta(item, false)}</span>
                <button type="button" class="agent-home-more" disabled={!item.sessionId} onclick={() => openItem(item)}>{copy.handoverOpenSource}</button>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}

    {#if crossChannel || handover.nextScheduled}
      <div class="agent-home-signals">
        {#if crossChannel}
          <article class="agent-home-signal" data-testid="handover-cross-channel">
            <span class="agent-home-signal-icon" aria-hidden="true"><ChatDots size={16} /></span>
            <h2 class="agent-home-signal-title">{copy.handoverCrossChannel.replace("{count}", String(crossChannel.count))}</h2>
            <span class="agent-home-signal-meta">{crossChannelMeta}</span>
            {#if crossChannel.channels.length}<span class="agent-home-signal-platforms" aria-hidden="true">{#each crossChannel.channels as channel}{#if CHANNEL_LOGOS[channel]}<img src={CHANNEL_LOGOS[channel]} alt="" width="16" height="16" />{/if}{/each}</span>{/if}
            <button type="button" class="agent-home-signal-action" onclick={onHistory}>{copy.handoverCrossChannelOpen}<ArrowRight size={13} aria-hidden="true" /></button>
          </article>
        {/if}
        {#if handover.nextScheduled}
          <article class="agent-home-signal" aria-label={copy.handoverBandNext}>
            <span class="agent-home-signal-icon" aria-hidden="true"><CalendarCheck size={16} /></span>
            <h2 class="agent-home-signal-title">{handover.nextScheduled.title}</h2>
            <span class="agent-home-signal-meta">{copy.handoverBandNext} · {formatTime(handover.nextScheduled.at)}</span>
            <span class="agent-home-signal-meta">{handover.nextScheduled.source === "durable" ? copy.handoverKindPlan : copy.handoverKindTask}</span>
          </article>
        {/if}
      </div>
    {/if}

    {@render composer()}
    {@render recentConversations(false)}
  </section>
{:else}
  <section class="agent-home" aria-label={agent.name}>
    <div class="agent-home-identity">
      {#if onActivity}
        <button type="button" class="agent-home-avatar-action" data-status={activityStatus} title={activityTitle} aria-label={activityTitle} onclick={onActivity}>
          <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
          <span class="agent-home-status-mark" aria-hidden="true"><StatusIcon size={13} /></span>
        </button>
      {:else}
        <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
      {/if}
      <h1>{agent.name}</h1>
      <p class="agent-home-greeting">{agent.description?.trim() || (locale === "zh-CN" ? "有什么想让我帮忙的吗？" : "What can I help you with?")}</p>
    </div>

    {@render composer()}

    {#if actions.length}
      <div class="agent-home-tasks" role="group" aria-label={copy.emptyChatQuickStart}>
        {#each actions as action (action.label)}
          {@const Icon = emptyActionIcon(action.icon)}
          <button type="button" class="agent-home-task" onclick={() => onPrompt(action.prompt)}><Icon size={16} aria-hidden="true" /><span>{action.label}</span></button>
        {/each}
      </div>
    {/if}

    {@render recentConversations(true)}
  </section>
{/if}
