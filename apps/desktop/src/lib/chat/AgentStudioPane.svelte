<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { DesktopAgentActivityItem, DesktopAgentItem } from "@molibot/desktop-contract";
  import { loadDesktopAgentActivity, loadDesktopAgents } from "../api";
  import type { Translation } from "../i18n";
  import AgentCityCanvas from "./AgentCityCanvas.svelte";
  import AgentCityFallback from "./AgentCityFallback.svelte";
  import {
    agentCityViewportHeight,
    type AgentCityAnchor,
    type AgentCityQuality,
    type AgentCityTheme
  } from "./agentCityScene";
  import {
    projectAgentCity,
    reconcileAgentCitySlots,
    type AgentCityFloor,
    type AgentCityProjection,
    type AgentCityStatus
  } from "./agentCityProjection";

  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceReady: boolean;
  export let onOpenAgentSettings: () => void;

  const SLOT_STORAGE_KEY = "molibot-agent-city-slots-v1";
  let agents: DesktopAgentItem[] = [];
  let activities: DesktopAgentActivityItem[] = [];
  let slotMap: Record<string, number> = readStoredSlots();
  let anchors: Record<string, AgentCityAnchor> = {};
  let loading = false;
  let error = "";
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshGeneration = 0;
  let quality: AgentCityQuality = "full";
  let fallback = false;
  let cityWidth = 1000;
  let cityShell: HTMLDivElement;
  let shellObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let theme: AgentCityTheme = currentTheme();

  function readStoredSlots(): Record<string, number> {
    try {
      const value = JSON.parse(localStorage.getItem(SLOT_STORAGE_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {};
    } catch {
      return {};
    }
  }

  function currentTheme(): AgentCityTheme {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark") return "dark";
    if (explicit === "light") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

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
  $: projection = projectAgentCity({ agents: visibleAgents, activities, slots: slotMap });
  $: enabledCount = visibleAgents.filter((agent) => agent.enabled).length;
  $: cityHeight = agentCityViewportHeight(projection.sceneFloors, cityWidth);

  async function refresh(): Promise<void> {
    if (!serviceReady || !serviceEndpoint || document.hidden) return;
    const endpoint = serviceEndpoint;
    const generation = ++refreshGeneration;
    loading = agents.length === 0;
    try {
      const [agentSummary, nextActivities] = await Promise.all([
        loadDesktopAgents(endpoint),
        loadDesktopAgentActivity(endpoint)
      ]);
      if (generation !== refreshGeneration || endpoint !== serviceEndpoint || !serviceReady) return;
      agents = agentSummary.items;
      activities = nextActivities;
      const nextSlots = reconcileAgentCitySlots(agents.filter((agent) => agent.id !== "default").map((agent) => agent.id), slotMap).slots;
      if (JSON.stringify(slotMap) !== JSON.stringify(nextSlots)) {
        slotMap = nextSlots;
        localStorage.setItem(SLOT_STORAGE_KEY, JSON.stringify(slotMap));
      }
      error = "";
    } catch (cause) {
      if (generation !== refreshGeneration || endpoint !== serviceEndpoint) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === refreshGeneration) loading = false;
    }
  }

  function handleVisibilityChange(): void {
    if (!document.hidden) void refresh();
  }

  function shortBotName(name: string): string {
    const value = name.trim();
    return value.length > 16 ? `${value.slice(0, 15)}…` : value;
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

  function statusLabel(status: AgentCityStatus): string {
    if (status === "working") return copy.agentStudioWorking;
    if (status === "completed") return copy.agentStudioCompleted;
    if (status === "error") return copy.agentStudioFailed;
    if (status === "disabled") return copy.agentStudioOffDuty;
    return copy.agentStudioAvailable;
  }

  function floorLabel(floor: AgentCityFloor): string {
    return copy.agentCityFloorLabel.replace("{floor}", String(floor.floorIndex + 1));
  }

  function anchorStyle(key: string): string {
    const anchor = anchors[key];
    if (!anchor?.visible) return "display:none";
    return `left:${anchor.x}px;top:${anchor.y}px`;
  }

  function allFloors(city: AgentCityProjection): AgentCityFloor[] {
    return [city.globalFloor, ...city.buildings.flatMap((building) => building.floors)];
  }

  function handleFallback(): void {
    fallback = true;
    quality = "fallback";
  }

  onMount(() => {
    void refresh();
    refreshTimer = setInterval(() => void refresh(), 2500);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    shellObserver = new ResizeObserver(([entry]) => {
      if (entry) cityWidth = entry.contentRect.width;
    });
    shellObserver.observe(cityShell);
    themeObserver = new MutationObserver(() => theme = currentTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemTheme = (): void => {
      theme = currentTheme();
    };
    systemTheme.addEventListener("change", handleSystemTheme);
    cleanupSystemTheme = () => systemTheme.removeEventListener("change", handleSystemTheme);
  });

  let cleanupSystemTheme = (): void => {};

  onDestroy(() => {
    refreshGeneration += 1;
    if (refreshTimer) clearInterval(refreshTimer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    shellObserver?.disconnect();
    themeObserver?.disconnect();
    cleanupSystemTheme();
  });
</script>

<section class="agent-studio" aria-label={copy.agentStudio}>
  <div class="agent-studio-summary" aria-label={copy.agentStudioSummary}>
    <span><strong>{visibleAgents.length}</strong>{copy.agentStudioResidents}</span>
    <span><strong>{enabledCount}</strong>{copy.agentStudioOnDuty}</span>
    <span><strong>{projection.workingCount}</strong>{copy.agentStudioWorkingCount}</span>
  </div>

  {#if !serviceReady}
    <div class="agent-studio-state"><i class="ph ph-plugs" aria-hidden="true"></i><p>{copy.agentStudioUnavailable}</p></div>
  {:else if loading}
    <div class="agent-studio-state"><i class="ph ph-circle-notch agent-studio-spinner" aria-hidden="true"></i><p>{copy.loadingChat}</p></div>
  {:else}
    <div class="agent-city-shell" class:agent-city-shell--fallback={fallback} bind:this={cityShell} style={`--agent-city-height:${cityHeight}px`}>
      <div class="agent-city-toolbar">
        <span><i class="ph ph-map-trifold" aria-hidden="true"></i>{copy.agentCityDispatchCenter}</span>
        <small>{fallback ? copy.agentCityFallbackNotice : quality === "low" ? copy.agentCityLowQuality : copy.agentCityFullQuality}</small>
      </div>

      {#if fallback}
        <AgentCityFallback {projection} {copy} {statusLabel} {onOpenAgentSettings} />
      {:else}
        <AgentCityCanvas {projection} {theme} onAnchors={(value) => { anchors = value; }} onQuality={(value) => { quality = value; }} onFallback={handleFallback} />
        <div class="agent-city-label-layer">
          <div class="agent-city-landmark-label" style={anchorStyle("owner")}>
            <strong>{copy.agentStudioOwner}</strong><span>{projection.owner.active ? copy.agentStudioCollaborating : copy.agentStudioOwnerIdle}</span>
          </div>
          {#each allFloors(projection) as floor (floor.key)}
            <button class="agent-city-agent-label" data-status={floor.state} style={anchorStyle(floor.key)} type="button" aria-label={`${floor.agent.name}, ${statusLabel(floor.state)}`}>
              <span class="agent-city-status-dot" aria-hidden="true"></span>
              <span class="agent-city-agent-copy"><strong>{floor.agent.name}</strong><small>{floor.kind === "global" ? copy.agentCityHeadquarters : `${floorLabel(floor)} · ${statusLabel(floor.state)}`}</small></span>
              <span class="agent-city-tooltip" role="tooltip">
                <span class="agent-city-tooltip-head"><strong>{floor.agent.name}</strong><em>{statusLabel(floor.state)}</em></span>
                <p>{floor.agent.description || copy.agentStudioNoDescription}</p>
                {#if floor.activity}
                  <dl>
                    <div><dt>{copy.agentStudioWorkingFor}</dt><dd>{shortBotName(floor.activity.botName)}</dd></div>
                    <div><dt>{copy.agentStudioChannel}</dt><dd>{channelLabel(floor.activity.channel)}</dd></div>
                    <div><dt>{copy.agentStudioStartedAt}</dt><dd>{activityTime(floor.activity.startedAt)}</dd></div>
                  </dl>
                  <span>{copy.agentStudioCurrentTask}</span><p>{floor.activity.taskPreview || copy.agentStudioTaskUnavailable}</p>
                {/if}
                <small>{floor.agent.modelOverrides > 0 ? `${floor.agent.modelOverrides} ${copy.agentStudioModelRoutes}` : copy.agentStudioDefaultRoute}</small>
                {#if floor.subagents.visible.length || floor.subagents.overflowCount}
                  <div class="agent-city-subagents">
                    <span>{copy.agentCityTeamStudio}</span>
                    {#each floor.subagents.visible as subagent (subagent.id)}<b>{subagent.name} · {statusLabel(subagent.status)}</b>{/each}
                    {#if floor.subagents.overflowCount}<b>+{floor.subagents.overflowCount}</b>{/if}
                  </div>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      {/if}

      {#if projection.hiddenAgentCount > 0}
        <p class="agent-city-overflow"><strong>+{projection.hiddenAgentCount}</strong> {copy.agentCityOverflow}</p>
      {/if}
    </div>
  {/if}

  {#if error}<p class="agent-studio-error" role="alert">{error}</p>{/if}
</section>
