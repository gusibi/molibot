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
    type AgentCityTheme,
    type AgentCityViewState
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
  let selectedFloorKey: string | null = null;
  let cityCanvas: AgentCityCanvas | null = null;
  let viewAdjusted = false;
  let followWorking = false;
  let searchOpen = false;
  let searchQuery = "";
  let searchIndex = 0;
  let searchInput: HTMLInputElement | null = null;

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
    if (explicit === "dark" || explicit === "midnight") return "dark";
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
  $: selectedFloor = selectedFloorKey ? cityFloors.find((floor) => floor.key === selectedFloorKey) ?? null : null;
  $: if (hoveredFloorKey && !cityFloors.some((floor) => floor.key === hoveredFloorKey)) {
    hoveredFloorKey = null;
    hoveredFloorAnchor = null;
  }
  $: if (selectedFloorKey && !cityFloors.some((floor) => floor.key === selectedFloorKey)) {
    selectedFloorKey = null;
  }
  $: searchResults = searchFloors(cityFloors, searchQuery);
  $: if (searchIndex >= searchResults.length) searchIndex = 0;
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
    selectedFloorKey = null;
    fallback = true;
    quality = "fallback";
  }

  function handleSelect(key: string | null): void {
    selectedFloorKey = key;
  }

  /** Working agents first, so the search box answers "who is busy?" too. */
  function searchFloors(floors: AgentCityFloor[], query: string): AgentCityFloor[] {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? floors.filter((floor) =>
          floor.agent.name.toLowerCase().includes(needle) ||
          floor.agent.description.toLowerCase().includes(needle))
      : floors;
    return [...matches]
      .sort((left, right) => Number(right.state === "working") - Number(left.state === "working"))
      .slice(0, 8);
  }

  function handleView(view: AgentCityViewState): void {
    viewAdjusted = view.adjusted;
    // Follow mode re-frames on its own; mirror its target into the detail card.
    if (view.following && view.followKey && view.followKey !== selectedFloorKey) {
      selectedFloorKey = view.followKey;
    }
  }

  function closeSelection(): void {
    selectedFloorKey = null;
    cityCanvas?.clearFocus();
  }

  function toggleFollow(): void {
    followWorking = !followWorking;
    cityCanvas?.setFollowWorking(followWorking);
  }

  function openSearch(): void {
    searchOpen = true;
    queueMicrotask(() => searchInput?.focus());
  }

  function closeSearch(): void {
    searchOpen = false;
    searchQuery = "";
    searchIndex = 0;
  }

  function jumpToFloor(key: string): void {
    selectedFloorKey = key;
    cityCanvas?.focusFloor(key);
    closeSearch();
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      closeSearch();
      return;
    }
    if (event.key === "ArrowDown") searchIndex = Math.min(searchResults.length - 1, searchIndex + 1);
    else if (event.key === "ArrowUp") searchIndex = Math.max(0, searchIndex - 1);
    else if (event.key === "Enter") {
      const match = searchResults[searchIndex];
      if (match) jumpToFloor(match.key);
    } else return;
    event.preventDefault();
  }

  // Escape backs out of a focused room. Zoom and reset stay on the toolbar
  // buttons so keyboard users reach them by tabbing, not by a hidden shortcut.
  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (searchOpen) {
      closeSearch();
      return;
    }
    if (!selectedFloorKey) return;
    closeSelection();
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

<svelte:window onkeydown={handleWindowKeydown} />

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
        {#if !fallback}
          <div class="agent-city-controls">
            <button type="button" class:agent-city-control-active={searchOpen} title={copy.agentCitySearchLabel} aria-label={copy.agentCitySearchLabel} aria-expanded={searchOpen} onclick={() => searchOpen ? closeSearch() : openSearch()}>
              <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
            </button>
            <button type="button" class:agent-city-control-active={followWorking} title={copy.agentCityFollowWorking} aria-label={copy.agentCityFollowWorking} aria-pressed={followWorking} onclick={toggleFollow}>
              <i class="ph ph-video-camera" aria-hidden="true"></i>
            </button>
            <button type="button" title={copy.agentCityZoomOut} aria-label={copy.agentCityZoomOut} onclick={() => cityCanvas?.zoom("out")}>
              <i class="ph ph-minus" aria-hidden="true"></i>
            </button>
            <button type="button" title={copy.agentCityZoomIn} aria-label={copy.agentCityZoomIn} onclick={() => cityCanvas?.zoom("in")}>
              <i class="ph ph-plus" aria-hidden="true"></i>
            </button>
            <button type="button" class:agent-city-control-active={viewAdjusted} title={copy.agentCityResetView} aria-label={copy.agentCityResetView} onclick={() => cityCanvas?.resetView()}>
              <i class="ph ph-crosshair-simple" aria-hidden="true"></i>
            </button>
          </div>
        {/if}
        <small>{fallback ? copy.agentCityFallbackNotice : quality === "low" ? copy.agentCityLowQuality : copy.agentCityFullQuality}</small>
      </div>

      {#if fallback}
        <AgentCityFallback {projection} {copy} {statusLabel} {onOpenAgentSettings} />
      {:else}
        <AgentCityCanvas
          bind:this={cityCanvas}
          {projection}
          {theme}
          onQuality={(value) => { quality = value; }}
          onFallback={handleFallback}
          onHover={handleHover}
          onSelect={handleSelect}
          onFocus={handleSelect}
          onView={handleView}
        />
        {#if searchOpen}
          <div class="agent-city-search">
            <input
              bind:this={searchInput}
              bind:value={searchQuery}
              type="search"
              placeholder={copy.agentCitySearchPlaceholder}
              aria-label={copy.agentCitySearchLabel}
              onkeydown={handleSearchKeydown}
            />
            <ul>
              {#each searchResults as floor, index (floor.key)}
                <li>
                  <button type="button" class:is-active={index === searchIndex} onclick={() => jumpToFloor(floor.key)} onmouseenter={() => { searchIndex = index; }}>
                    <strong>{floor.agent.name}</strong>
                    <small data-status={floor.state}>{statusLabel(floor.state)}</small>
                  </button>
                </li>
              {:else}
                <li class="agent-city-search-empty">{copy.agentCitySearchEmpty}</li>
              {/each}
            </ul>
          </div>
        {/if}
        <p class="agent-city-hint">{copy.agentCityInteractionHint}</p>
        {#if selectedFloor}
          <aside class="agent-city-detail" aria-label={selectedFloor.agent.name}>
            <header>
              <strong>{selectedFloor.agent.name}</strong>
              <span data-status={selectedFloor.state}>{statusLabel(selectedFloor.state)}</span>
              <button type="button" title={copy.agentCityCloseDetail} aria-label={copy.agentCityCloseDetail} onclick={closeSelection}>
                <i class="ph ph-x" aria-hidden="true"></i>
              </button>
            </header>
            <p>{selectedFloor.agent.description || copy.agentStudioNoDescription}</p>
            {#if selectedFloor.activity}
              <small>{shortBotName(selectedFloor.activity.botName)} · {channelLabel(selectedFloor.activity.channel)} · {activityTime(selectedFloor.activity.startedAt)}</small>
              <p>{selectedFloor.activity.taskPreview || copy.agentStudioTaskUnavailable}</p>
            {/if}
            <em>{selectedFloor.agent.modelOverrides > 0 ? `${selectedFloor.agent.modelOverrides} ${copy.agentStudioModelRoutes}` : copy.agentStudioDefaultRoute}</em>
            {#if selectedFloor.subagents.visible.length || selectedFloor.subagents.overflowCount}
              <small>{selectedFloor.subagents.visible.map((subagent) => `${subagent.name} · ${statusLabel(subagent.status)}`).join(" · ")}{selectedFloor.subagents.overflowCount ? ` · +${selectedFloor.subagents.overflowCount}` : ""}</small>
            {/if}
            <div class="agent-city-detail-actions">
              <button type="button" onclick={() => selectedFloorKey && cityCanvas?.focusFloor(selectedFloorKey)}>{copy.agentCityFocusFloor}</button>
              <button type="button" onclick={onOpenAgentSettings}>{copy.agentCityOpenAgentSettings}</button>
            </div>
          </aside>
        {/if}
        {#if hoveredFloor && hoveredFloor.key !== selectedFloorKey}
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
