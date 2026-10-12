<script lang="ts">
  import Run from "reicon-svelte/icons/Run";
  import MoonSleep from "reicon-svelte/icons/MoonSleep";
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
  import type { DesktopAgentActivityItem, DesktopConversationItem } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { agentActivityLabel } from "./agentActivity";
  let { activity, activityReady = false, onActivity, agent, sessions, locale, copy, actions, onPrompt, onSession, onHistory, formatTime, composer, historyExpanded = false, onDelete, onCopyPath, onRevealInFinder }: {
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
  } = $props();
  const activityStatus = $derived(agent.enabled === false ? "disabled" : !activityReady ? "unknown" : activity?.status ?? "idle");
  const activityLabel = $derived(agentActivityLabel(agent.enabled !== false, activity, activityReady, copy));
  const StatusIcon = $derived(activityStatus === "working" ? Run : activityStatus === "completed" ? Check : activityStatus === "error" ? X : activityStatus === "disabled" ? Minus : activityStatus === "unknown" ? CircleInfo : MoonSleep);
  const activityTitle = $derived([agent.name, activityLabel, activityReady && activity?.status === "working" && activity.taskPreview ? activity.taskPreview : "", copy.agentViewActivity].filter(Boolean).join(" · "));
</script>
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
        <Button class="agent-home-task" onclick={() => onPrompt(action.prompt)}><Icon size={16} aria-hidden="true" /><span>{action.label}</span></Button>
      {/each}
    </div>

  {/if}
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
</section>
