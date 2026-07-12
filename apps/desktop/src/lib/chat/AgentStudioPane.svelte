<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { DesktopAgentActivityItem, DesktopAgentItem } from "@molibot/desktop-contract";
  import { loadDesktopAgentActivity, loadDesktopAgents } from "../api";
  import type { Translation } from "../i18n";

  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceReady: boolean;
  export let onOpenAgentSettings: () => void;

  let agents: DesktopAgentItem[] = [];
  let activities: DesktopAgentActivityItem[] = [];
  let loading = false;
  let error = "";
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  $: globalAgent = {
    id: "default",
    name: copy.agentStudioGlobalName,
    description: copy.agentStudioGlobalDescription,
    enabled: true,
    sandboxEnabled: null,
    modelOverrides: 0,
    modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" }
  } satisfies DesktopAgentItem;
  $: visibleAgents = agents.some((agent) => agent.id === "default") ? agents : [globalAgent, ...agents];
  $: enabledCount = visibleAgents.filter((agent) => agent.enabled).length;
  $: activityByAgent = new Map(activities.map((activity) => [activity.agentId, activity]));
  $: workingCount = activities.filter((activity) => activity.status === "working").length;

  async function refresh(): Promise<void> {
    if (!serviceReady || !serviceEndpoint || document.hidden) return;
    loading = agents.length === 0;
    try {
      const [agentSummary, nextActivities] = await Promise.all([
        loadDesktopAgents(serviceEndpoint),
        loadDesktopAgentActivity(serviceEndpoint)
      ]);
      agents = agentSummary.items;
      activities = nextActivities;
      error = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function handleVisibilityChange(): void {
    if (!document.hidden) void refresh();
  }

  function shortBotName(name: string): string {
    const value = name.trim();
    return value.length > 12 ? `${value.slice(0, 11)}…` : value;
  }

  function channelLabel(channel: string): string {
    if (channel === "feishu") return copy.channelFeishu;
    if (channel === "weixin") return copy.channelWeixin;
    if (channel === "telegram") return "Telegram";
    if (channel === "qq") return "QQ";
    if (channel === "web") return "Web";
    return channel;
  }

  function activityTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  }

  onMount(() => {
    void refresh();
    refreshTimer = setInterval(() => void refresh(), 2500);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });
</script>

<section class="agent-studio" aria-label={copy.agentStudio}>
  <div class="agent-studio-intro">
    <div>
      <span class="agent-studio-eyebrow">{copy.agentStudioEyebrow}</span>
      <h2>{copy.agentStudio}</h2>
      <p>{copy.agentStudioHint}</p>
    </div>
    <div class="agent-studio-summary" aria-label={copy.agentStudioSummary}>
      <span><strong>{visibleAgents.length}</strong>{copy.agentStudioResidents}</span>
      <span><strong>{enabledCount}</strong>{copy.agentStudioOnDuty}</span>
      <span><strong>{workingCount}</strong>{copy.agentStudioWorkingCount}</span>
    </div>
  </div>

  {#if !serviceReady}
    <div class="agent-studio-state"><i class="ph ph-plugs" aria-hidden="true"></i><p>{copy.agentStudioUnavailable}</p></div>
  {:else if loading}
    <div class="agent-studio-state"><i class="ph ph-circle-notch agent-studio-spinner" aria-hidden="true"></i><p>{copy.loadingChat}</p></div>
  {:else if visibleAgents.length === 0}
    <div class="agent-studio-empty">
      <div class="pug pug--waiting" aria-hidden="true"><span class="pug-ear pug-ear--left"></span><span class="pug-ear pug-ear--right"></span><span class="pug-head"><i></i><b></b><em></em></span><span class="pug-body"></span><span class="pug-leg pug-leg--left"></span><span class="pug-leg pug-leg--right"></span><span class="pug-tail"></span></div>
      <h3>{copy.agentStudioEmpty}</h3>
      <p>{copy.agentStudioEmptyHint}</p>
      <button class="secondary-button" type="button" onclick={onOpenAgentSettings}>{copy.agentStudioCreate}</button>
    </div>
  {:else}
    <div class="agent-office" style={`--agent-count:${visibleAgents.length}`}>
      <div class="agent-office-wall" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="agent-office-floor" aria-hidden="true"></div>
      <div class="agent-office-plants" aria-hidden="true"><i></i><i></i></div>
      <div class:agent-owner--connected={workingCount > 0} class="agent-owner">
        <div class="agent-owner-scene" aria-hidden="true">
          <span class="agent-owner-rug"></span>
          <span class="agent-owner-chair"></span>
          <span class="agent-owner-avatar"><i></i><b></b></span>
          <span class="agent-owner-desk"></span>
          <span class="agent-owner-monitor"><i></i></span>
          <span class="agent-owner-mug"></span>
        </div>
        <div class="agent-owner-nameplate"><strong>{copy.agentStudioOwner}</strong><small>{workingCount > 0 ? copy.agentStudioCollaborating : copy.agentStudioOwnerIdle}</small></div>
      </div>
      <div class="agent-desks">
        {#each visibleAgents as agent, index (agent.id)}
          {@const activity = activityByAgent.get(agent.id)}
          {@const status = !agent.enabled ? "disabled" : activity?.status ?? "idle"}
          <article class:agent-desk--disabled={status === "disabled"} class:agent-desk--working={status === "working"} class:agent-desk--completed={status === "completed"} class:agent-desk--error={status === "error"} class:agent-desk--active-context={Boolean(activity)} class="agent-desk" style={`--agent-index:${index};--walk-delay:${index * -0.7}s`}>
            {#if status === "working"}<span class="agent-link" aria-hidden="true"><i class="ph-fill ph-file-text"></i><i class="ph-fill ph-file-text"></i><i class="ph-fill ph-file-text"></i></span>{/if}
            <div class="agent-desk-scene" aria-hidden="true">
              <span class="agent-monitor"><i></i></span><span class="agent-table"></span><span class="agent-chair"></span>
              {#if status === "working"}
                <div class="pug pug--typing"><span class="pug-ear pug-ear--left"></span><span class="pug-ear pug-ear--right"></span><span class="pug-head"><i></i><b></b><em></em></span><span class="pug-body"></span><span class="pug-leg pug-leg--left"></span><span class="pug-leg pug-leg--right"></span><span class="pug-paw pug-paw--left"></span><span class="pug-paw pug-paw--right"></span><span class="pug-tail"></span></div>
              {:else}
                <div class="pug-rest"><span class="pug-cushion"></span><div class="pug pug--phone"><span class="pug-ear pug-ear--left"></span><span class="pug-ear pug-ear--right"></span><span class="pug-head"><i></i><b></b><em></em></span><span class="pug-body"></span><span class="pug-leg pug-leg--left"></span><span class="pug-leg pug-leg--right"></span><span class="pug-tail"></span><span class="pug-phone"><i></i></span></div></div>
              {/if}
            </div>
            <div class="agent-desk-copy">
              <span class:agent-status--disabled={status === "disabled"} class:agent-status--working={status === "working"} class:agent-status--completed={status === "completed"} class:agent-status--error={status === "error"} class="agent-status"><i></i>{status === "working" ? copy.agentStudioWorking : status === "completed" ? copy.agentStudioCompleted : status === "error" ? copy.agentStudioFailed : status === "disabled" ? copy.agentStudioOffDuty : copy.agentStudioAvailable}</span>
              {#if activity}
                <button class="agent-work-context" type="button" aria-label={`${copy.agentStudioWorkingFor} ${activity.botName}`}>
                  <span class="agent-bot-badge"><i class="ph-fill ph-robot" aria-hidden="true"></i>{shortBotName(activity.botName)}</span>
                  <div class="agent-work-tooltip" role="tooltip">
                    <span>{copy.agentStudioWorkingFor}</span><strong>{activity.botName}</strong>
                    <dl><div><dt>{copy.agentStudioActivityStatus}</dt><dd>{status === "working" ? copy.agentStudioWorking : status === "completed" ? copy.agentStudioCompleted : copy.agentStudioFailed}</dd></div><div><dt>{copy.agentStudioChannel}</dt><dd>{channelLabel(activity.channel)}</dd></div><div><dt>{copy.agentStudioStartedAt}</dt><dd>{activityTime(activity.startedAt)}</dd></div></dl>
                    <span>{copy.agentStudioCurrentTask}</span><p>{activity.taskPreview || copy.agentStudioTaskUnavailable}</p>
                  </div>
                </button>
              {/if}
              <h3>{agent.name}</h3>
              <p>{agent.description || copy.agentStudioNoDescription}</p>
              <small>{agent.modelOverrides > 0 ? `${agent.modelOverrides} ${copy.agentStudioModelRoutes}` : copy.agentStudioDefaultRoute}</small>
            </div>
            {#if activity?.subagents.length}
              <div class="subagent-bay" aria-label={copy.agentStudioSubagents}>
                {#each activity.subagents.slice(0, 3) as subagent (subagent.id)}
                  <div class:subagent-station--completed={subagent.status === "completed"} class:subagent-station--error={subagent.status === "error"} class="subagent-station">
                    <span class="subagent-link" aria-hidden="true"></span>
                    <span class="subagent-desk" aria-hidden="true"><i></i></span>
                    <span class="subagent-pug" aria-hidden="true"><i></i><b></b><em></em></span>
                    <span>{subagent.name}<small>{subagent.status === "working" ? copy.agentStudioWorking : subagent.status === "completed" ? copy.agentStudioCompleted : copy.agentStudioFailed}</small></span>
                  </div>
                {/each}
                {#if activity.subagents.length > 3}<span class="subagent-more">+{activity.subagents.length - 3}</span>{/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    </div>
  {/if}

  {#if error}<p class="agent-studio-error" role="alert">{error}</p>{/if}
</section>
