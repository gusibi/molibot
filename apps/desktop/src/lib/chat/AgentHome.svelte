<script lang="ts">
  import MoonSleep from "reicon-svelte/icons/MoonSleep";
  import Run from "reicon-svelte/icons/Run";
  import Check from "reicon-svelte/icons/Check";
  import X from "reicon-svelte/icons/X";
  import Minus from "reicon-svelte/icons/Minus";
  import CircleInfo from "reicon-svelte/icons/CircleInfo";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import { type Snippet } from "svelte";
  import AgentConversationRow from "./AgentConversationRow.svelte";
  import AgentHomeInbox from "./AgentHomeInbox.svelte";
  import MomoStage from "./MomoStage.svelte";
  import Button from "../components/ui/Button.svelte";
  import { emptyActionIcon, type EmptyActionIcon } from "./activityIcons";
  import {
    type HomeDeskCounts,
    type HomePresenceInput,
    homeAwayMs,
    homeBrief,
    homeMood,
    momoExpressionFor,
    usesMomoExpressions
  } from "./homePresence";
  import type {
    DesktopAgentActivityItem,
    DesktopConversationItem,
    DesktopHandover,
    DesktopHandoverPending
  } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import type { HomeInbox } from "./homeInbox";
  import { agentActivityLabel } from "./agentActivity";

  let {
    activity,
    activityReady = false,
    onActivity,
    agent,
    sessions,
    sessionCount = sessions.length,
    enteredAt = Date.now(),
    locale,
    copy,
    actions,
    onPrompt,
    onSession,
    onHistory,
    formatTime,
    composer,
    historyExpanded: _historyExpanded = false,
    onDelete,
    onCopyPath,
    onRevealInFinder,
    handover = null,
    lastAcknowledgedAt = handover?.lastAcknowledgedAt,
    inbox,
    handoverLoading: _handoverLoading = false,
    handoverStale = false,
    serviceOffline = false,
    handoverError = "",
    handoverBusyId = "",
    agentLabel: _agentLabel = (id: string) => id,
    onHandoverOpen,
    onHandoverResolve,
    onHandoverAnswer,
    onHandoverPlan,
    endpoint = "",
    expressions = true,
    onOpenMemory = () => {},
    onTasks = () => {},
    onPlans = () => {},
    onFiles = () => {},
    onNotifications = undefined,
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
    sessionCount?: number;
    enteredAt?: number;
    locale: string;
    copy: Translation;
    actions: ReadonlyArray<{ icon: EmptyActionIcon; label: string; prompt: string }>;
    onPrompt: (prompt: string) => void;
    onSession: (item: DesktopConversationItem) => void | Promise<void>;
    onHistory: () => void;
    formatTime: (value: string) => string;
    handover?: DesktopHandover | null;
    lastAcknowledgedAt?: string;
    inbox?: HomeInbox;
    handoverLoading?: boolean;
    handoverStale?: boolean;
    serviceOffline?: boolean;
    handoverError?: string;
    handoverBusyId?: string;
    agentLabel?: (agentId: string) => string;
    onHandoverOpen?: (input: { sessionId?: string; channel?: string; title?: string; agentId?: string; planId?: string; executionId?: string }) => boolean | Promise<boolean>;
    onHandoverResolve?: (items: DesktopHandoverPending[], decision: "approve_once" | "reject") => void;
    onHandoverAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onHandoverPlan?: (item: DesktopHandoverPending, mode: "manual" | "accept_edits") => void;
    endpoint?: string;
    /** A room shares this home but is not Momo, so it opts out of the expressions. */
    expressions?: boolean;
    onOpenMemory?: () => void;
    onTasks?: () => void;
    onPlans?: (planId?: string) => void;
    onFiles?: () => void;
    onNotifications?: () => void;
    onResultFile?: (sessionId: string, file: import("./turnFiles").TurnFileItem) => void;
  } = $props();

  let deskCounts = $state<HomeDeskCounts>({ decisionCount: 0, doneCount: 0, failedCount: 0 });
  let attentive = $state(false);
  let hop = $state(0);
  let clock = $state(Date.now());
  const memoryReview = $derived(handover?.memoryReview);
  const activityStatus = $derived(agent.enabled === false ? "disabled" : !activityReady ? "unknown" : activity?.status ?? "idle");
  const activityLabel = $derived(agentActivityLabel(agent.enabled !== false, activity, activityReady, copy));
  const StatusIcon = $derived(activityStatus === "working" ? Run : activityStatus === "completed" ? Check : activityStatus === "error" ? X : activityStatus === "disabled" ? Minus : activityStatus === "unknown" ? CircleInfo : MoonSleep);
  const activityTitle = $derived([agent.name, activityLabel, activityReady && activity?.status === "working" && activity.taskPreview ? activity.taskPreview : "", onActivity ? copy.agentViewActivity : ""].filter(Boolean).join(" · "));

  const liveRun = $derived(activityStatus === "working" ? activity : null);
  const liveElapsed = $derived.by(() => {
    if (!liveRun) return "";
    const started = Date.parse(String(liveRun.startedAt ?? ""));
    return Number.isFinite(started) ? elapsedLabel(clock - started) : "";
  });
  const liveSummary = $derived.by(() => {
    if (!liveRun) return "";
    const head = liveRun.taskPreview?.trim() || copy.handoverLive;
    const extras = [liveElapsed];
    const subagents = liveRun.subagents?.length ?? 0;
    if (subagents > 0) {
      const label = subagents === 1 ? copy.handoverSubagent : copy.handoverSubagents;
      extras.push(label.replace("{count}", String(subagents)));
    }
    if (liveRun.channel) extras.push(channelLabel(liveRun.channel));
    return [head, ...extras.filter(Boolean)].join(" · ");
  });

  // The greeting and the sentence count what is really on the desk.
  const presence = $derived({
    enabled: agent.enabled !== false,
    activityStatus: (activityStatus === "disabled" ? "idle" : activityStatus) as HomePresenceInput["activityStatus"],
    stale: handoverStale || serviceOffline,
    ...deskCounts,
    sessionCount,
    hour: new Date(clock).getHours()
  });
  const mood = $derived(homeMood(presence));
  const canWake = $derived(mood === "idle" || mood === "welcome" || mood === "sleeping");
  const expression = $derived(attentive && canWake ? "thinking" : momoExpressionFor(mood));
  // Momo's expressions only stand in for the default avatar; a custom avatar is the Agent's own face.
  const expressive = $derived(Boolean(expressions && usesMomoExpressions(agent.avatar)));
  const brief = $derived(
    homeBrief(
      {
        ...presence,
        name: agent.name,
        description: agent.description?.trim() ?? "",
        awayMs: homeAwayMs(lastAcknowledgedAt, enteredAt),
        liveSummary
      },
      copy
    )
  );

  let compactHome = $state(false);
  const showQuickStarts = $derived(actions.length > 0 && !compactHome);

  $effect(() => {
    clock = Date.now();
    const timer = setInterval(() => (clock = Date.now()), liveRun ? 1_000 : 60_000);
    return () => clearInterval(timer);
  });

  function onComposeFocusIn(): void {
    if (!attentive && expressive && canWake) hop++;
    attentive = true;
  }

  function onComposeFocusOut(event: FocusEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) attentive = false;
  }

  function elapsedLabel(ms: number): string {
    if (!Number.isFinite(ms) || ms < 60_000) {
      return copy.handoverElapsedSeconds.replace("{count}", String(Math.max(1, Math.round(ms / 1000))));
    }
    if (ms < 3_600_000) {
      return copy.handoverElapsedMinutes.replace("{count}", String(Math.max(1, Math.round(ms / 60_000))));
    }
    return copy.handoverElapsedHours.replace("{count}", String(Math.max(1, Math.round(ms / 3_600_000))));
  }

  function channelLabel(channel: string): string {
    if (channel === "feishu") return copy.channelFeishu;
    if (channel === "weixin") return copy.channelWeixin;
    if (channel === "telegram") return copy.channelTelegram;
    if (channel === "qq") return copy.channelQq;
    if (channel === "web") return copy.channelWeb;
    return channel;
  }
</script>

{#snippet statusMark()}
  <StatusIcon size={13} />
{/snippet}

{#snippet recentConversations(showEmpty: boolean)}
  {#if sessions.length || showEmpty}
    <section class="agent-home-history agent-home-history--inline" aria-label={copy.homeRecent}>
      <h2>{copy.homeRecent}</h2>
      {#if sessions.length}
        <nav class="agent-home-recent-links" aria-label={copy.homeRecent}>
          {#each sessions.slice(0, 2) as item (item.sessionId)}
            <AgentConversationRow {item} source={item.channel} sourceLabel={channelLabel(item.channel)} {locale} {formatTime} showSource onSelect={() => onSession(item)} onDelete={onDelete ? () => onDelete(item) : undefined} onCopyPath={onCopyPath ? () => onCopyPath(item) : undefined} onRevealInFinder={onRevealInFinder ? () => onRevealInFinder(item) : undefined} />
          {/each}
        </nav>
      {:else}
        <span class="agent-home-meta">{copy.homeNoConversations}</span>
      {/if}
      <button type="button" class="agent-home-section-link" onclick={onHistory}>{copy.homeAllHistory}<ArrowRight size={14} aria-hidden="true" /></button>
    </section>
  {/if}
{/snippet}

{#snippet quickStarts()}
  {#if showQuickStarts}
    <div class="agent-home-tasks" role="group" aria-label={copy.emptyChatQuickStart}>
      {#each actions as action (action.label)}
        {@const Icon = emptyActionIcon(action.icon)}
        <Button variant="text" class="agent-home-task" onclick={() => onPrompt(action.prompt)}><Icon size={16} aria-hidden="true" /><span>{action.label}</span></Button>
      {/each}
    </div>
  {/if}
{/snippet}

<section class="agent-home" class:agent-home--has-feed={compactHome} aria-label={agent.name}>
  <div class="agent-home-light" aria-hidden="true"></div>
  <div class="agent-home-sheet">
    <div class="agent-home-layout">
      <div class="agent-home-stage">
        <MomoStage
          expression={expressive ? expression : undefined}
          avatar={agent.avatar ?? ""}
          name={agent.name}
          size={compactHome ? "pin" : "stage"}
          status={activityStatus}
          title={activityTitle}
          onclick={onActivity}
          live={mood === "working"}
          {hop}
          statusIcon={statusMark}
        />
      </div>
      <div class="agent-home-desk">
        <header class="agent-home-identity" class:agent-home-identity--compact={compactHome}>
          <h1 class="agent-home-hello">
            {#if sessionCount !== 0}<span class="sr-only">{agent.name} · </span>{/if}{brief.hello}
          </h1>
          {#if liveRun}
            <p class="agent-home-live-inline agent-home-say">
              <span class="agent-home-live-dot" aria-hidden="true"></span>
              <span>{brief.say}</span>
            </p>
          {:else}
            <p class="agent-home-greeting agent-home-say">{brief.say}</p>
          {/if}
        </header>

        {#if handoverStale || serviceOffline}
          <p class="agent-home-handover-stale" role="status">{handoverStale ? copy.handoverStale : copy.homeOffline}</p>
        {/if}
        {#if handoverError}
          <p class="agent-home-handover-stale" data-tone="danger" role="alert">{copy.handoverActionFailed.replace("{message}", handoverError)}</p>
        {/if}

        <div class="agent-home-compose-area">
          <div onfocusin={onComposeFocusIn} onfocusout={onComposeFocusOut}>
            {@render composer()}
          </div>
          {@render quickStarts()}
          {@render recentConversations(!compactHome)}
        </div>

        {#if handover && endpoint && inbox}
          <AgentHomeInbox
            {inbox}
            {endpoint}
            {locale}
            stale={handoverStale}
            revision={handover.generatedAt}
            {formatTime}
            {copy}
            memoryReview={memoryReview}
            pending={handover.pending}
            busyId={handoverBusyId}
            onResolve={onHandoverResolve}
            onAnswer={onHandoverAnswer}
            onPlan={onHandoverPlan}
            onOpen={onHandoverOpen}
            onHistory={onHistory}
            {onPlans}
            {onTasks}
            {onFiles}
            {onNotifications}
            {onResultFile}
            {onOpenMemory}
            onPresenceChange={(presence) => {
              if (presence.hasContent) compactHome = true;
              if (
                deskCounts.decisionCount !== presence.decisionCount ||
                deskCounts.doneCount !== presence.doneCount ||
                deskCounts.failedCount !== presence.failedCount
              ) {
                deskCounts = { decisionCount: presence.decisionCount, doneCount: presence.doneCount, failedCount: presence.failedCount };
              }
            }}
          />
        {/if}
      </div>
    </div>
  </div>
</section>
