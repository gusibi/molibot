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
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import Button from "../components/ui/Button.svelte";
  import { emptyActionIcon, type EmptyActionIcon } from "./activityIcons";
  import type {
    DesktopAgentActivityItem,
    DesktopConversationItem,
    DesktopHandover,
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
    historyExpanded: _historyExpanded = false,
    onDelete,
    onCopyPath,
    onRevealInFinder,
    handover = null,
    handoverLoading: _handoverLoading = false,
    handoverStale = false,
    handoverError = "",
    handoverBusyId = "",
    agentLabel: _agentLabel = (id: string) => id,
    onHandoverOpen,
    onHandoverResolve,
    onHandoverAnswer,
    onHandoverPlan,
    agentId: _agentId = "",
    endpoint = "",
    onMemoryChanged = async () => {},
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
    locale: string;
    copy: Translation;
    actions: ReadonlyArray<{ icon: EmptyActionIcon; label: string; prompt: string }>;
    onPrompt: (prompt: string) => void;
    onSession: (item: DesktopConversationItem) => void | Promise<void>;
    onHistory: () => void;
    formatTime: (value: string) => string;
    handover?: DesktopHandover | null;
    handoverLoading?: boolean;
    handoverStale?: boolean;
    handoverError?: string;
    handoverBusyId?: string;
    agentLabel?: (agentId: string) => string;
    onHandoverOpen?: (input: { sessionId?: string; channel?: string; title?: string; agentId?: string; planId?: string; executionId?: string }) => void | Promise<void>;
    onHandoverResolve?: (items: DesktopHandoverPending[], decision: "approve_once" | "reject") => void;
    onHandoverAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onHandoverPlan?: (item: DesktopHandoverPending, mode: "manual" | "accept_edits") => void;
    agentId?: string;
    endpoint?: string;
    onMemoryChanged?: () => Promise<void>;
    onOpenMemory?: () => void;
    onTasks?: () => void;
    onPlans?: (planId?: string) => void;
    onFiles?: () => void;
    onNotifications?: () => void;
    onResultFile?: (sessionId: string, file: import("./turnFiles").TurnFileItem) => void;
  } = $props();

  let hasInboxContent = $state(false);
  const memoryReview = $derived(handover?.memoryReview);
  const activityStatus = $derived(agent.enabled === false ? "disabled" : !activityReady ? "unknown" : activity?.status ?? "idle");
  const activityLabel = $derived(agentActivityLabel(agent.enabled !== false, activity, activityReady, copy));
  const StatusIcon = $derived(activityStatus === "working" ? Run : activityStatus === "completed" ? Check : activityStatus === "error" ? X : activityStatus === "disabled" ? Minus : activityStatus === "unknown" ? CircleInfo : MoonSleep);
  const activityTitle = $derived([agent.name, activityLabel, activityReady && activity?.status === "working" && activity.taskPreview ? activity.taskPreview : "", copy.agentViewActivity].filter(Boolean).join(" · "));

  const liveRun = $derived(activity?.status === "working" ? activity : null);
  const liveElapsed = $derived.by(() => {
    if (!liveRun) return "";
    const started = Date.parse(String(liveRun.startedAt ?? ""));
    return Number.isFinite(started) ? elapsedLabel(Date.now() - started) : "";
  });
  const liveSummary = $derived.by(() => {
    if (!liveRun) return "";
    const head = liveRun.taskPreview?.trim() || copy.handoverLive;
    const extras = [liveElapsed];
    if (liveRun.subagents?.length) extras.push(copy.handoverSubagents.replace("{count}", String(liveRun.subagents.length)));
    if (liveRun.channel) extras.push(channelLabel(liveRun.channel));
    return [head, ...extras.filter(Boolean)].join(" · ");
  });

  // Only show generic starter prompts when the home is quiet; once real items
  // appear below the composer, keep the screen focused on them.
  const showQuickStarts = $derived(actions.length > 0 && !hasInboxContent);
  const compactHome = $derived(hasInboxContent);

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
  <header class="agent-home-identity" class:agent-home-identity--compact={compactHome}>
    {#if onActivity}
      <button type="button" class="agent-home-avatar-action" data-status={activityStatus} title={activityTitle} aria-label={activityTitle} onclick={onActivity}>
        <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
        <span class="agent-home-status-mark" aria-hidden="true"><StatusIcon size={13} /></span>
      </button>
    {:else}
      <AgentAvatar name={agent.name} src={agent.avatar ?? ""} />
    {/if}
    <h1>{agent.name}</h1>
    {#if liveRun}
      {#if onActivity}
        <button type="button" class="agent-home-live-inline" onclick={onActivity}>
          <span class="agent-home-live-dot" aria-hidden="true"></span>
          <span>{liveSummary}</span>
        </button>
      {:else}
        <p class="agent-home-live-inline">
          <span class="agent-home-live-dot" aria-hidden="true"></span>
          <span>{liveSummary}</span>
        </p>
      {/if}
    {:else}
      <p class="agent-home-greeting">{agent.description?.trim() || copy.homeGreeting}</p>
    {/if}
  </header>

  {#if handoverStale}
    <p class="agent-home-handover-stale" role="status">{copy.handoverStale}</p>
  {/if}
  {#if handoverError}
    <p class="agent-home-handover-stale" data-tone="danger" role="alert">{copy.handoverActionFailed.replace("{message}", handoverError)}</p>
  {/if}

  <div class="agent-home-compose-area">
    {@render composer()}
    {@render quickStarts()}
    {@render recentConversations(!compactHome)}
  </div>

  {#if handover && endpoint}
    <AgentHomeInbox
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
      {onMemoryChanged}
      {onOpenMemory}
      onPresenceChange={(present) => (hasInboxContent = present)}
    />
  {/if}
</section>
