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
  import AgentHomeWork from "./AgentHomeWork.svelte";
  import AgentHomeMemory from "./AgentHomeMemory.svelte";
  import AgentHomeDelivery from "./AgentHomeDelivery.svelte";
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
    agentId = "",
    endpoint = "",
    onMemoryChanged = async () => {},
    onOpenMemory = () => {},
    onTasks = () => {},
    onPlans = () => {},
    onFiles = () => {},
    onResultFile = () => {}
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
    endpoint?: string;
    onMemoryChanged?: () => Promise<void>;
    onOpenMemory?: () => void;
    onTasks?: () => void;
    onPlans?: () => void;
    onFiles?: () => void;
    onResultFile?: (sessionId: string, file: import("./turnFiles").TurnFileItem) => void;
  } = $props();

  let itemsExpanded = $state(false);
  let pendingExpanded = $state(false);
  let executionsExpanded = $state(false);
  let executionDetailsOpen = $state(false);
  let memorySeen = $state(false);
  const memoryReview = $derived(handover?.memoryReview);
  const showMemory = $derived(Boolean(memoryReview && (memoryReview.items.length || memoryReview.skillDraftCount || memoryReview.unavailable || memorySeen)));
  $effect(() => {
    if (!handover) memorySeen = false;
    else if (handover.memoryReview?.items.length) memorySeen = true;
  });
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
  // A delivery that declared a reading surface deserves the reading slot; the
  // rest stay compact rows.
  const heroItem = $derived(completedItems.find((item) => Boolean(item.display)) ?? completedItems[0] ?? null);
  const restItems = $derived(completedItems.filter((item) => item !== heroItem));
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
  const showHandover = $derived(Boolean(handover && (handover.state === "active" || showingPrevious || showMemory)));
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

  const taskSummary = $derived.by(() => {
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

  const handoverSummary = $derived.by(() => {
    const count = memoryReview?.items.length ?? 0;
    const hasTaskFacts = displayCounts.completed > 0 || displayCounts.failed > 0 || displayCounts.pending > 0;
    if (count) {
      const memorySummary = copy.homeMemoryPendingSummary.replace("{count}", `${count}${memoryReview?.hasMore ? "+" : ""}`);
      return [hasTaskFacts ? taskSummary : "", memorySummary].filter(Boolean).join(" · ");
    }
    if (memoryReview?.skillDraftCount) return [hasTaskFacts ? taskSummary : "", locale === "zh-CN" ? "有技能草稿待审核" : "Skill drafts need review"].filter(Boolean).join(" · ");
    if (memoryReview?.unavailable && !hasTaskFacts) return copy.homeMemoryUnavailable;
    return taskSummary;
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
    if (item.display?.type === "briefing" || item.display?.type === "topic-proposals" || item.display?.type === "document") return item.display.title;
    return item.taskId ? copy.handoverTaskEntry : copy.handoverRunEntry;
  }

  function deliveryLabel(item: DesktopHandoverItem): string {
    switch (item.delivery?.status) {
      case "delivered": return copy.handoverDeliveryDelivered;
      case "failed": return copy.handoverDeliveryFailed;
      case "not_required": return copy.handoverDeliveryInApp;
      default: return item.kind.endsWith("failed") ? "" : copy.handoverDeliveryUnknown;
    }
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
      : next.querySelector<HTMLElement>("summary, button:not(:disabled), [href], [tabindex='0']");
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
    const delivery = deliveryLabel(item);
    if (delivery) parts.push(delivery);
    if (item.nextRunAt) parts.push(copy.handoverNextRun.replace("{time}", formatTime(item.nextRunAt)));
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
  <section class="agent-home-history agent-home-history--inline" aria-label={copy.homeRecent}>
    <h2>{copy.homeRecent}</h2>
    {#if sessions.length}
      <nav class="agent-home-recent-links" aria-label={copy.homeRecent}>
        {#each sessions.slice(0, 2) as item (item.sessionId)}
          <AgentConversationRow {item} source={item.channel} sourceLabel={channelLabel(item.channel)} {locale} {formatTime} showSource onSelect={() => onSession(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onCopyPath={onCopyPath ? () => onCopyPath(item) : undefined} onRevealInFinder={onRevealInFinder ? () => onRevealInFinder(item) : undefined} />
        {/each}
      </nav>
    {:else if showEmpty}
      <span class="agent-home-meta">{copy.homeNoConversations}</span>
    {/if}
    <button type="button" class="agent-home-section-link" onclick={onHistory}>{copy.homeAllHistory}<ArrowRight size={14} aria-hidden="true" /></button>
  </section>
{/snippet}

{#snippet quickStarts()}
  {#if actions.length}
    <div class="agent-home-tasks" role="group" aria-label={copy.emptyChatQuickStart}>
      {#each actions as action (action.label)}
        {@const Icon = emptyActionIcon(action.icon)}
        <Button variant="text" class="agent-home-task" onclick={() => onPrompt(action.prompt)}><Icon size={16} aria-hidden="true" /><span>{action.label}</span></Button>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet decisionColumn()}
  <div class="agent-home-decisions-column">
    {#if showMemory && memoryReview}
      <AgentHomeMemory {locale} review={memoryReview} {endpoint} stale={handoverStale} {copy} {formatTime} onChanged={onMemoryChanged} {onOpenMemory} />
    {/if}
    {@render decisionsSection()}
  </div>
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
            {#if heroItem.display}
              <p class="agent-home-delivery-task">{itemLabel(heroItem)}</p>
              <AgentHomeDelivery display={heroItem.display} {copy} {locale} openable={Boolean(heroItem.sessionId)} onOpen={() => openItem(heroItem)} />
            {:else}
              <h3 class="agent-home-hero-title">{itemLabel(heroItem)}</h3>
              {#if heroItem.resultPreview}
                <p class="agent-home-hero-preview">{heroItem.resultPreview}</p>
              {/if}
            {/if}
            <div class="agent-home-card-foot">
              <span class="agent-home-meta">{itemMeta(heroItem, false)}</span>
              {#if !heroItem.display}
                <Button variant="primary" disabled={!heroItem.sessionId} onclick={() => openItem(heroItem)}>{copy.handoverOpenSource}<ArrowRight size={14} aria-hidden="true" /></Button>
              {/if}
            </div>
          </article>

          {#if visibleRest.length > 0}
            <div class="agent-home-rows">
              {#each visibleRest as item (item.id)}
                {#if item.display}
                  <details class="agent-home-row-display" data-handover-row>
                    <summary class="agent-home-row-display-head">
                      <span class="agent-home-row-title">{itemLabel(item)}</span>
                      <span class="agent-home-meta">{itemMeta(item)}</span>
                      <ArrowRight size={16} class="agent-home-row-arrow" aria-hidden="true" />
                    </summary>
                    <AgentHomeDelivery display={item.display} {copy} {locale} openable={Boolean(item.sessionId)} onOpen={() => openItem(item)} />
                  </details>
                {:else}
                  <button type="button" class="agent-home-row" data-handover-row onclick={() => openItem(item)} disabled={!item.sessionId}>
                    <span class="agent-home-row-title">{itemLabel(item)}{#if item.kind === "task-recovered"}<span class="agent-home-chip tiny">{copy.handoverRecoveredLabel}</span>{/if}</span>
                    {#if item.resultPreview}<span class="agent-home-row-preview">{item.resultPreview}</span>{/if}
                    <span class="agent-home-meta">{itemMeta(item)}</span>
                    <ArrowRight size={16} class="agent-home-row-arrow" aria-hidden="true" />
                  </button>
                {/if}
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
              {#if item.goal}<p class="agent-home-card-context"><span>{copy.handoverDecisionGoal}</span>{item.goal}</p>{/if}
              {#if item.scope && item.scope !== item.detail}<p class="agent-home-card-context"><span>{copy.handoverDecisionScope}</span>{item.scope}</p>{/if}
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

{#snippet work()}
  {#if handover && endpoint}<AgentHomeWork {endpoint} {locale} stale={handoverStale} revision={handover.generatedAt} {formatTime} {onPlans} {onTasks} {onFiles} {onResultFile} {agentLabel} />{/if}
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
    <div class="agent-home-date"><span>{new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" }).format(new Date(handover.generatedAt))}</span><span>{copy.homeVerified.replace("{time}", formatTime(handover.generatedAt))}</span></div>
    <header class="agent-home-identity agent-home-identity--work">
      {#if onActivity}
        <button type="button" class="agent-home-avatar-action" data-status={activityStatus} title={activityTitle} aria-label={activityTitle} onclick={onActivity}>
          <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
          <span class="agent-home-status-mark" aria-hidden="true"><StatusIcon size={13} /></span>
        </button>
      {:else}<AgentAvatar name={agent.name} src={agent.avatar ?? ""} />{/if}
      <h1>{agent.name}</h1>
      <p class="agent-home-greeting">{agent.description?.trim() || copy.homeGreeting}</p>
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

    <div class="agent-home-work-heading"><h2>{copy.homePrepared}</h2><p class="agent-home-meta" data-testid="handover-summary">{handoverSummary}</p></div>

    <div class="agent-home-dashboard" class:has-results={Boolean(heroItem)} class:has-decisions={Boolean(handover.pending.length || showMemory)} use:measureDashboard>
      {#if wideDashboard}
        {@render resultsSection()}
        {@render decisionColumn()}
      {:else}
        {@render decisionColumn()}
        {@render resultsSection()}
      {/if}
    </div>

    {#if displayItems.length > 0}
      <details class="agent-home-band agent-home-executions" bind:open={executionDetailsOpen}>
        <summary>{executionDetailsOpen ? copy.homeHideExecutions : copy.homeShowExecutions}</summary>
        <div class="agent-home-band-head">
          <h2 class="agent-home-band-label" id="home-executions-title">{copy.handoverExecutions}</h2>
        </div>
        <table class="agent-home-execution-table" aria-label={copy.handoverExecutions}>
          <thead><tr><th scope="col">{copy.handoverExecutionTask}</th><th scope="col">{copy.handoverExecutionState}</th><th scope="col">{copy.handoverExecutionResult}</th><th scope="col">{copy.handoverExecutionNext}</th></tr></thead>
          <tbody>
            {#each visibleExecutions as item (item.id)}
              <tr>
                <th scope="row">
                  {#if item.sessionId}
                    <button type="button" class="agent-home-execution-task" onclick={() => openItem(item)}>{itemLabel(item)}</button>
                  {:else}
                    {itemLabel(item)}
                  {/if}
                </th>
                <td data-label={copy.handoverExecutionState}><span class="agent-home-execution-state" data-failed={item.kind.endsWith("failed")}><span aria-hidden="true">{item.kind.endsWith("failed") ? "×" : "✓"}</span>{item.kind.endsWith("failed") ? copy.handoverFailedLabel : item.kind === "task-recovered" ? copy.handoverRecoveredLabel : copy.handoverCompletedLabel}</span></td>
                <td data-label={copy.handoverExecutionResult}><span class="agent-home-execution-result">{item.kind.endsWith("failed") ? (item.detail ?? copy.handoverNotProvided) : (item.resultPreview || copy.handoverNotProvided)}</span></td>
                <td data-label={copy.handoverExecutionNext}><span class="agent-home-execution-result">{item.nextRunAt ? formatTime(item.nextRunAt) : copy.handoverNotProvided}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if displayItems.length > 5}
          <Button aria-expanded={executionsExpanded} onclick={() => (executionsExpanded = !executionsExpanded)}>{executionsExpanded ? copy.handoverCollapseItems : copy.handoverShowExecutions.replace("{count}", String(displayItems.length - 5))}</Button>
        {/if}
      </details>
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
          {#each handover.nextScheduledItems ?? [handover.nextScheduled] as schedule}
          <article class="agent-home-signal" aria-label={copy.handoverBandNext}>
            <span class="agent-home-signal-icon" aria-hidden="true"><CalendarCheck size={16} /></span>
            <h2 class="agent-home-signal-title">{schedule.title}</h2>
            <span class="agent-home-signal-meta">{copy.handoverBandNext} · {formatTime(schedule.at)}</span>
            <span class="agent-home-signal-meta">{schedule.source === "durable" ? copy.handoverKindPlan : copy.handoverKindTask}</span>
          </article>
          {/each}
        {/if}
      </div>
    {/if}

    {@render work()}
    <div class="agent-home-compose-area">{@render composer()}{@render quickStarts()}{@render recentConversations(false)}</div>
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

    {@render work()}
    {@render composer()}

    {@render quickStarts()}

    {@render recentConversations(true)}
  </section>
{/if}
