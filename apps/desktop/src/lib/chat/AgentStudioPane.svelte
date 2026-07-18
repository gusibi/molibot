<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { ActivityScheduler, agentActivityPolicy, documentActivityVisibility } from "../native/activityScheduler";
  import type { DesktopAgentActivityItem, DesktopAgentItem } from "@molibot/desktop-contract";
  import { loadDesktopAgentActivity, loadDesktopAgents } from "../api";
  import type { Translation } from "../i18n";
  import AgentCityCanvas from "./AgentCityCanvas.svelte";
  import AgentCityFallback from "./AgentCityFallback.svelte";
  import {
    agentCityViewportHeight,
    type AgentCityQuality,
    type AgentCityTheme
  } from "./agentCityScene";
  import {
    projectAgentCity,
    reconcileAgentCitySlots,
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
  let loading = false;
  let error = "";
  let refreshScheduler: ActivityScheduler | null = null;
  let refreshGeneration = 0;
  let quality: AgentCityQuality = "full";
  let fallback = false;
  let cityWidth = 1000;
  let cityShell: HTMLDivElement;
  let shellObserver: ResizeObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  let theme: AgentCityTheme = currentTheme();
  let hoveredFloorKey: string | null = null;
  let hoveredFloorAnchor: { x: number; y: number } | null = null;

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
  $: cityFloors = [projection.globalFloor, ...projection.buildings.flatMap((building) => building.floors)];
  $: hoveredFloor = hoveredFloorKey ? cityFloors.find((floor) => floor.key === hoveredFloorKey) ?? null : null;
  $: if (hoveredFloorKey && !cityFloors.some((floor) => floor.key === hoveredFloorKey)) {
    hoveredFloorKey = null;
    hoveredFloorAnchor = null;
  }
  $: enabledCount = visibleAgents.filter((agent) => agent.enabled).length;
  $: cityHeight = agentCityViewportHeight(projection.sceneFloors, cityWidth);

  async function refresh(): Promise<void> {
    if (!serviceReady || !serviceEndpoint) return;
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

  function statusLabel(status: AgentCityStatus): string {
    if (status === "working") return copy.agentStudioWorking;
    if (status === "completed") return copy.agentStudioCompleted;
    if (status === "error") return copy.agentStudioFailed;
    if (status === "disabled") return copy.agentStudioOffDuty;
    return copy.agentStudioAvailable;
  }

  function handleFallback(): void {
    hoveredFloorKey = null;
    hoveredFloorAnchor = null;
    fallback = true;
    quality = "fallback";
  }

  function handleHover(hover: { key: string; x: number; y: number } | null): void {
    hoveredFloorKey = hover?.key ?? null;
    hoveredFloorAnchor = hover ? { x: hover.x, y: hover.y } : null;
  }

  function hoverCardStyle(): string {
    if (!hoveredFloorAnchor) return "display:none";
    return `left:${hoveredFloorAnchor.x}px;top:${hoveredFloorAnchor.y}px`;
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

  onMount(() => {
    refreshScheduler = new ActivityScheduler(agentActivityPolicy, refresh, documentActivityVisibility);
    refreshScheduler.start();
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
    refreshScheduler?.dispose();
    refreshScheduler = null;
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
        <AgentCityCanvas {projection} {theme} onQuality={(value) => { quality = value; }} onFallback={handleFallback} onHover={handleHover} />
        {#if hoveredFloor}
          <div class="agent-city-hover-card" style={hoverCardStyle()}>
            <strong>{hoveredFloor.agent.name}</strong>
            <span>{statusLabel(hoveredFloor.state)}</span>
            <p>{hoveredFloor.agent.description || copy.agentStudioNoDescription}</p>
            {#if hoveredFloor.activity}
              <small>{shortBotName(hoveredFloor.activity.botName)} · {channelLabel(hoveredFloor.activity.channel)} · {activityTime(hoveredFloor.activity.startedAt)}</small>
              <p>{hoveredFloor.activity.taskPreview || copy.agentStudioTaskUnavailable}</p>
            {/if}
            <em>{hoveredFloor.agent.modelOverrides > 0 ? `${hoveredFloor.agent.modelOverrides} ${copy.agentStudioModelRoutes}` : copy.agentStudioDefaultRoute}</em>
            {#if hoveredFloor.subagents.visible.length || hoveredFloor.subagents.overflowCount}
              <small>{hoveredFloor.subagents.visible.map((subagent) => `${subagent.name} · ${statusLabel(subagent.status)}`).join(" · ")}{hoveredFloor.subagents.overflowCount ? ` · +${hoveredFloor.subagents.overflowCount}` : ""}</small>
            {/if}
          </div>
        {/if}
        <div class="sr-only">
          <p>{copy.agentStudioSummary}</p>
          <p>{projection.workingCount} {copy.agentStudioWorkingCount}</p>
          <ul>
            <li>{projection.globalFloor.agent.name}: {statusLabel(projection.globalFloor.state)}</li>
            {#each projection.buildings as building (building.index)}
              {#each building.floors as floor (floor.key)}
                <li>{floor.agent.name}: {statusLabel(floor.state)}</li>
              {/each}
            {/each}
          </ul>
        </div>
      {/if}

      {#if projection.hiddenAgentCount > 0}
        <p class="agent-city-overflow"><strong>+{projection.hiddenAgentCount}</strong> {copy.agentCityOverflow}</p>
      {/if}
    </div>
  {/if}

  {#if error}<p class="agent-studio-error" role="alert">{error}</p>{/if}
</section>
