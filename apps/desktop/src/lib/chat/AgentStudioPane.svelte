<script lang="ts">
  import Crosshairs from "../icons/duotone/components/Crosshairs.svelte";
  import Loader from "reicon-svelte/icons/Loader";
  import Magnifier from "../icons/duotone/components/Magnifier.svelte";
  import Minus from "reicon-svelte/icons/Minus";
  import Plug from "reicon-svelte/icons/Plug";
  import Plus from "reicon-svelte/icons/Plus";
  import Video from "../icons/duotone/components/Video.svelte";
  import { onDestroy, onMount } from "svelte";
  import type {
    DesktopAgentActionKind,
    DesktopAgentActionStepItem,
    DesktopAgentActivityItem,
    DesktopAgentItem
  } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import AgentCityCanvas from "./AgentCityCanvas.svelte";
  import AgentCityFallback from "./AgentCityFallback.svelte";
  import AgentCityInspector from "./AgentCityInspector.svelte";
  import { clampHoverCardPosition, layoutHudNodes } from "./agentCityHudLayout";
  import {
    agentCityViewportHeight,
    type AgentCityHudCoords,
    type AgentCityQuality,
    type AgentCityTheme,
    type AgentCityViewState
  } from "./agentCityScene";
  import type { AgentCityThemeRecipe, AgentCityVisualTheme } from "./agentCityTheme";
  import {
    projectAgentCity,
    reconcileAgentCitySlots,
    type AgentCityFloor,
    type AgentCityStatus
  } from "./agentCityProjection";

  export let copy: Translation;
  export let serviceReady: boolean;
  export let onOpenAgentSettings: (agentId?: string) => void;
  export let onOpenAgentChat: (agentId: string) => void = () => {};

  const SLOT_STORAGE_KEY = "molibot-agent-city-slots-v1";
  const VIEW_STORAGE_KEY = "molibot-agent-studio-view-v1";
  export let agents: DesktopAgentItem[] = [];
  export let activities: DesktopAgentActivityItem[] = [];
  export let activityReady = false;
  export let activityError = "";
  export let focusedAgentId = "";
  let slotMap: Record<string, number> = readStoredSlots();
  let viewMode: "cards" | "3d" = readStoredViewMode();
  let quality: AgentCityQuality = "full";
  let fallback = false;
  let cityWidth = 1000;
  let cityViewportHeight = 560;
  let themeObserver: MutationObserver | null = null;
  let theme: AgentCityTheme = currentTheme();
  let sky = currentSky();
  let visualTheme: AgentCityVisualTheme = currentVisualTheme();
  let hoveredFloorKey: string | null = null;
  let hoveredFloorAnchor: { x: number; y: number } | null = null;
  let selectedFloorKey: string | null = null;
  let appliedFocusedAgentId = "";
  let cityCanvas: AgentCityCanvas | null = null;
  let viewAdjusted = false;
  let followWorking = false;
  let searchOpen = false;
  let searchQuery = "";
  let searchIndex = 0;
  let searchInput: HTMLInputElement | null = null;
  let rosterQuery = "";
  let rosterFilter: "all" | "active" = "all";
  let hudCoords: AgentCityHudCoords = {
    anchors: {},
    satellites: {},
    owner: { x: 0, y: 0, visible: false }
  };

  function readStoredSlots(): Record<string, number> {
    try {
      const value = JSON.parse(localStorage.getItem(SLOT_STORAGE_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {};
    } catch {
      return {};
    }
  }

  function readStoredViewMode(): "cards" | "3d" {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      return saved === "3d" || saved === "cards" ? saved : "cards";
    } catch {
      return "cards";
    }
  }

  function setViewMode(next: "cards" | "3d"): void {
    viewMode = next;
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors in restricted contexts.
    }
  }

  function currentTheme(): AgentCityTheme {
    const explicit = document.documentElement.getAttribute("data-resolved-appearance");
    if (explicit === "dark") return "dark";
    if (explicit === "light") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function resolvedThemeColor(name: string, fallback: string): string {
    // getPropertyValue() returns the custom property's token stream, so values
    // such as `var(--header-bg)` stay unresolved. Let the browser resolve the
    // variable/color-mix through a real CSS `color` declaration before Three.js
    // sees it; otherwise several theme families collapse to the same fallback.
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = `position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;color:var(${name}, ${fallback})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color.trim();
    probe.remove();
    return resolved || fallback;
  }

  // The shell paints `--agent-city-sky`; the WebGL canvas must use the exact
  // same resolved colour or a seam shows at the panel edge.
  function currentSky(): string {
    return resolvedThemeColor("--agent-city-sky", currentTheme() === "dark" ? "#101820" : "#eaf3f5");
  }

  function currentVisualTheme(): AgentCityVisualTheme {
    const root = document.documentElement;
    const token = (name: string, fallbackValue: string): string => resolvedThemeColor(name, fallbackValue);
    const family = root.dataset.themeFamily || "macos";
    const recipe = (root.dataset.themeRecipe || (family.startsWith("imported-") ? "imported" : "native")) as AgentCityThemeRecipe;
    return {
      family,
      recipe,
      accent: token("--accent", currentTheme() === "dark" ? "#48aeff" : "#006bff"),
      surface: token("--mac-window-background", token("--content-bg", currentTheme() === "dark" ? "#151b20" : "#f4f5f6")),
      panel: token("--panel-bg", token("--card-bg", currentTheme() === "dark" ? "#20282e" : "#ffffff")),
      card: token("--card-bg", token("--panel-bg", currentTheme() === "dark" ? "#20282e" : "#ffffff")),
      separator: token("--separator", currentTheme() === "dark" ? "#47515a" : "#c9d0d5"),
      online: token("--online", "#28a948"),
      danger: token("--danger", "#ea001d"),
      warning: token("--warning", "#c26a00"),
      skillAccent: token("--skill-accent", "#8b5cf6"),
      miniappAccent: token("--miniapp-accent", "#0d9488")
    };
  }

  $: globalAgent = {
    id: "default",
    name: copy.agentStudioGlobalName,
    description: copy.agentStudioGlobalDescription,
    enabled: true,
    canExecute: true,
    permissionMode: null,
    modelOverrides: 0,
    modelRouting: { textModelKey: "", sttModelKey: "" }
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
  $: activeWorkerCount = cityFloors.reduce(
    (total, floor) => total + floor.subagents.instances.filter((subagent) => subagent.status === "working").length,
    0
  );
  $: totalToolCalls = cityFloors.reduce(
    (total, floor) => total + (floor.activity?.toolCallCount ?? floor.runs[0]?.toolCallCount ?? 0),
    0
  );
  $: totalModelCalls = cityFloors.reduce(
    (total, floor) => total + (floor.activity?.modelCallCount ?? floor.runs[0]?.modelCallCount ?? 0),
    0
  );
  $: totalActiveTokens = cityFloors.reduce(
    (total, floor) => total + (floor.activity?.totalTokens ?? floor.runs[0]?.totalTokens ?? 0),
    0
  );
  $: rosterFloors = [...cityFloors].sort((left, right) => {
    const rank = (status: AgentCityStatus): number =>
      status === "working" ? 4 : status === "error" ? 3 : status === "completed" ? 2 : status === "idle" ? 1 : 0;
    const delta = rank(right.state) - rank(left.state);
    if (delta !== 0) return delta;
    if (left.kind === "global") return -1;
    if (right.kind === "global") return 1;
    return left.agent.name.localeCompare(right.agent.name);
  });
  $: filteredRosterFloors = rosterFloors.filter((floor) => {
    if (rosterFilter === "active" && floor.state !== "working" && floor.state !== "error") return false;
    const needle = rosterQuery.trim().toLowerCase();
    if (!needle) return true;
    return (
      floor.agent.name.toLowerCase().includes(needle) ||
      floor.agent.description.toLowerCase().includes(needle) ||
      Boolean(floor.activity?.taskPreview.toLowerCase().includes(needle))
    );
  });
  $: if (projection.workingCount === 0 && rosterFilter === "active") {
    rosterFilter = "all";
  }
  $: cityHeight = agentCityViewportHeight(projection.sceneFloors, cityWidth);
  $: hudLayout = layoutHudNodes(cityFloors, hudCoords, selectedFloorKey, hoveredFloorKey);
  $: hoverCardPos = hoveredFloorAnchor
    ? clampHoverCardPosition(hoveredFloorAnchor, cityWidth, cityViewportHeight || cityHeight)
    : null;

  $: {
    const nextSlots = reconcileAgentCitySlots(agents.filter(agent => agent.id !== "default").map(agent => agent.id), slotMap).slots;
    if (JSON.stringify(slotMap) !== JSON.stringify(nextSlots)) {
      slotMap = nextSlots;
      localStorage.setItem(SLOT_STORAGE_KEY, JSON.stringify(slotMap));
    }
  }
  $: if (focusedAgentId !== appliedFocusedAgentId) {
    const floor = cityFloors.find(item => item.agent.id === focusedAgentId);
    if (floor || !focusedAgentId) {
      selectedFloorKey = floor?.key ?? null;
      appliedFocusedAgentId = focusedAgentId;
    }
  }

  function statusLabel(status: AgentCityStatus): string {
    if (status === "working") return copy.agentStudioWorking;
    if (status === "completed") return copy.agentStudioCompleted;
    if (status === "error") return copy.agentStudioFailed;
    if (status === "disabled") return copy.agentStudioOffDuty;
    return copy.agentStudioAvailable;
  }

  function actionKindLabel(kind: DesktopAgentActionKind): string {
    if (kind === "tool_call") return copy.agentCityActionTool;
    if (kind === "model_call") return copy.agentCityActionModel;
    if (kind === "skill_usage") return copy.agentCityActionSkill;
    if (kind === "subagent_task") return copy.agentCityActionSubagent;
    return copy.agentCityActionApproval;
  }

  function currentFloorAction(floor: AgentCityFloor): DesktopAgentActionStepItem | null {
    return floor.currentAction ?? floor.activity?.currentAction ?? null;
  }

  function floorSteps(floor: AgentCityFloor): DesktopAgentActionStepItem[] {
    return floor.steps ?? floor.activity?.steps ?? [];
  }

  function shortModelLabel(floor: AgentCityFloor): string {
    const raw = floor.activity?.activeModel || floor.agent.modelRouting.textModelKey || "";
    if (!raw) return copy.agentStudioDefaultRoute;
    const parts = raw.split(/[:/|]/).filter(Boolean);
    const short = parts[parts.length - 1] || raw;
    return short.length > 22 ? `${short.slice(0, 21)}…` : short;
  }

  function permissionLabel(floor: AgentCityFloor): string {
    if (!floor.agent.permissionMode) return copy.agentCityInspectorInherited;
    return {
      plan: copy.permissionModePlan,
      manual: copy.permissionModeManual,
      accept_edits: copy.permissionModeAcceptEdits,
      auto: copy.permissionModeAuto
    }[floor.agent.permissionMode];
  }

  $: recentRunsFeed = cityFloors
    .flatMap((floor) =>
      floor.runs.map((run) => ({
        runId: run.runId,
        floorKey: floor.key,
        agentId: floor.agent.id,
        agentName: floor.agent.name,
        status: run.status,
        taskPreview: run.taskPreview || copy.agentStudioTaskUnavailable,
        botName: run.botName,
        channel: run.channel,
        startedAt: run.startedAt,
        toolCalls: run.toolCallCount ?? 0,
        subagentCount: run.subagents.length
      }))
    )
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, 10);

  $: telemetryFeed = cityFloors
    .flatMap((floor) => {
      const steps = floorSteps(floor);
      if (steps.length > 0) {
        return steps.slice(-4).map((step) => ({
          id: `${floor.key}:${step.id}`,
          floorKey: floor.key,
          agentName: floor.agent.name,
          kind: step.kind,
          name: step.name,
          status: step.status,
          time: step.startedAt
        }));
      }
      if (floor.activity) {
        return [{
          id: `${floor.key}:${floor.activity.runId}`,
          floorKey: floor.key,
          agentName: floor.agent.name,
          kind: "model_call" as DesktopAgentActionKind,
          name: floor.activity.taskPreview || copy.agentStudioWorking,
          status: floor.state === "error" ? "error" as const : floor.state === "completed" ? "completed" as const : "working" as const,
          time: floor.activity.startedAt
        }];
      }
      return [];
    })
    .sort((left, right) => Date.parse(right.time) - Date.parse(left.time))
    .slice(0, 8);

  function handleHudUpdate(coords: AgentCityHudCoords): void {
    hudCoords = coords;
  }

  function hudNodeStyle(x: number, y: number, zIndex: number): string {
    return `transform:translate3d(${x}px, ${y}px, 0) translate(-50%, -100%);z-index:${zIndex}`;
  }

  function satelliteNodeStyle(x: number, y: number, visible: boolean): string {
    if (!visible) return "display:none";
    return `transform:translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  }

  function formatCompactTokens(tokens: number | undefined): string {
    if (!tokens || tokens <= 0) return "";
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
    return `${tokens} tok`;
  }

  function inspectFloor(key: string, event?: MouseEvent): void {
    event?.stopPropagation();
    selectedFloorKey = selectedFloorKey === key ? null : key;
    if (selectedFloorKey) cityCanvas?.focusFloor(selectedFloorKey);
  }

  function subagentSummary(floor: AgentCityFloor): string {
    return floor.subagents.groups
      .map((group) => `${group.role} ×${group.total}`)
      .join(" · ");
  }

  function handleFallback(): void {
    hoveredFloorKey = null;
    hoveredFloorAnchor = null;
    selectedFloorKey = null;
    fallback = true;
    quality = "fallback";
  }

  function handleSelect(key: string | null): void {
    const floor = cityFloors.find(item => item.key === key);
    if (floor) onOpenAgentChat(floor.agent.id);
    else selectedFloorKey = null;
  }

  /** Working agents first, so the search box answers "who is busy?" too. */
  function searchFloors(floors: AgentCityFloor[], query: string): AgentCityFloor[] {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? floors.filter((floor) =>
          floor.agent.name.toLowerCase().includes(needle) ||
          floor.agent.description.toLowerCase().includes(needle) ||
          floor.subagents.groups.some((group) => group.role.toLowerCase().includes(needle)) ||
          floor.activity?.botName.toLowerCase().includes(needle) ||
          floor.activity?.taskPreview.toLowerCase().includes(needle))
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

  function hoverCardStyle(pos: { x: number; y: number; placement: "above" | "below" } | null): string {
    if (!pos) return "display:none";
    const translateY = pos.placement === "above" ? "-100%" : "0%";
    return `left:${pos.x}px;top:${pos.y}px;transform:translate(-50%, ${translateY})`;
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

  function observeCityShell(node: HTMLDivElement) {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      cityWidth = entry.contentRect.width;
      cityViewportHeight = entry.contentRect.height;
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  onMount(() => {
    themeObserver = new MutationObserver(() => {
      theme = currentTheme();
      sky = currentSky();
      visualTheme = currentVisualTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-resolved-appearance", "data-theme-family", "data-theme-recipe", "style"]
    });
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemTheme = (): void => {
      theme = currentTheme();
      sky = currentSky();
      visualTheme = currentVisualTheme();
    };
    systemTheme.addEventListener("change", handleSystemTheme);
    cleanupSystemTheme = () => systemTheme.removeEventListener("change", handleSystemTheme);
  });

  let cleanupSystemTheme = (): void => {};

  onDestroy(() => {
    themeObserver?.disconnect();
    cleanupSystemTheme();
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<section class="agent-studio" aria-label={copy.agentStudio}>
  <header class="agent-studio-header">
    <div class="agent-studio-summary" aria-label={copy.agentStudioSummary}>
      <span class="agent-studio-summary-status" data-active={projection.workingCount > 0}>
        <i></i>
        {#if activityReady && projection.workingCount > 0}
          <strong>{projection.workingCount}</strong>{copy.agentStudioWorkingCount}
        {:else}
          <strong>{enabledCount}</strong>{copy.agentStudioOnDuty}
        {/if}
      </span>
      <span class="agent-studio-summary-divider" aria-hidden="true"></span>
      <span><strong>{visibleAgents.length}</strong>{copy.agentStudioResidents}</span>
      {#if activityReady && activeWorkerCount > 0}
        <span><strong>{activeWorkerCount}</strong>{copy.agentStudioWorkers}</span>
      {/if}
      {#if activityReady && totalToolCalls > 0}
        <span><strong>{totalToolCalls}</strong>{copy.agentCityMetricTools}</span>
      {/if}
      {#if activityReady && totalModelCalls > 0}
        <span><strong>{totalModelCalls}</strong>{copy.agentCityMetricModels}</span>
      {/if}
      {#if activityReady && totalActiveTokens > 0}
        <span><strong>{formatCompactTokens(totalActiveTokens)}</strong>{copy.agentCityMetricTokens}</span>
      {/if}
    </div>

    <div class="agent-studio-header-actions">
      <div class="agent-studio-view-switch" role="tablist" aria-label={copy.agentStudio}>
        <button
          type="button"
          role="tab"
          class:is-active={viewMode === "cards"}
          aria-selected={viewMode === "cards"}
          onclick={() => setViewMode("cards")}
        >
          {copy.agentStudioViewCards}
        </button>
        <button
          type="button"
          role="tab"
          class:is-active={viewMode === "3d"}
          aria-selected={viewMode === "3d"}
          onclick={() => setViewMode("3d")}
        >
          {copy.agentStudioView3D}
        </button>
      </div>
      <button type="button" class="agent-studio-manage-btn" onclick={() => onOpenAgentSettings()}>
        {copy.agentCityOpenAgentSettings}
      </button>
    </div>
  </header>

  {#if !serviceReady}
    <div class="agent-studio-state"><Plug size={28} aria-hidden="true" /><p>{copy.agentStudioUnavailable}</p></div>
  {:else if !activityReady && activityError}
    <div class="agent-studio-state" role="alert"><p>{copy.agentActivityUnavailable}</p></div>
  {:else if !activityReady}
    <div class="agent-studio-state"><Loader class="agent-studio-spinner" size={28} aria-hidden="true" /><p>{copy.loadingChat}</p></div>
  {:else}
    {#if viewMode === "cards"}
      <div class="agent-studio-workbench">
        <div class="agent-studio-workbench-bar">
          <div class="agent-studio-workbench-search">
            <Magnifier size={14} aria-hidden="true" />
            <input
              bind:value={rosterQuery}
              type="search"
              placeholder={copy.agentCitySearchLabel}
              aria-label={copy.agentCitySearchLabel}
            />
          </div>
          {#if projection.workingCount > 0}
            <div class="agent-city-roster-filter" role="group" aria-label={copy.agentStudioActivityStatus}>
              <button type="button" class:is-active={rosterFilter === "all"} onclick={() => (rosterFilter = "all")}>
                {copy.agentCityRosterTitle} ({visibleAgents.length})
              </button>
              <button type="button" class:is-active={rosterFilter === "active"} onclick={() => (rosterFilter = "active")}>
                {copy.agentStudioWorking} ({projection.workingCount})
              </button>
            </div>
          {/if}
        </div>

        <div class="agent-studio-card-grid">
          {#each filteredRosterFloors as floor (floor.key)}
            {@const action = currentFloorAction(floor)}
            {@const latestRun = floor.runs[0] ?? null}
            <article class="agent-studio-card" data-status={floor.state}>
              <header class="agent-studio-card-head">
                <div class="agent-studio-card-title">
                  <span class="agent-city-hud-dot" data-status={floor.state}></span>
                  <strong>{floor.agent.name}</strong>
                </div>
                <span class="agent-studio-card-status" data-status={floor.state}>{statusLabel(floor.state)}</span>
              </header>

              <p class="agent-studio-card-desc">{floor.agent.description || copy.agentStudioNoDescription}</p>

              {#if action && (floor.state === "working" || floor.state === "error" || action.status === "waiting")}
                <div class="agent-studio-card-activity" data-status={action.status}>
                  <span>{actionKindLabel(action.kind)}</span>
                  <code>{action.name}</code>
                </div>
              {:else if floor.activity?.taskPreview}
                <div class="agent-studio-card-activity" data-status={floor.state}>
                  <p>{floor.activity.taskPreview}</p>
                  <small>{channelLabel(floor.activity.channel)} · {activityTime(floor.activity.startedAt)}</small>
                </div>
              {:else if latestRun}
                <div class="agent-studio-card-activity" data-status={latestRun.status}>
                  <p>{latestRun.taskPreview || copy.agentStudioTaskUnavailable}</p>
                  <small>{channelLabel(latestRun.channel)} · {activityTime(latestRun.startedAt)}</small>
                </div>
              {/if}

              <dl class="agent-studio-card-meta">
                <div>
                  <dt>{copy.model}</dt>
                  <dd title={floor.agent.modelRouting.textModelKey || copy.agentStudioDefaultRoute}>{shortModelLabel(floor)}</dd>
                </div>
                <div>
                  <dt>{copy.permissionMode}</dt>
                  <dd>{permissionLabel(floor)}</dd>
                </div>
              </dl>

              <footer class="agent-studio-card-actions">
                <button type="button" class="agent-studio-card-primary" onclick={() => onOpenAgentChat(floor.agent.id)}>
                  {copy.agentCityInspectorOpenChat}
                </button>
                <button type="button" class="agent-studio-card-secondary" onclick={() => onOpenAgentSettings(floor.agent.id)}>
                  {copy.agentStudioConfigure}
                </button>
              </footer>
            </article>
          {:else}
            <p class="agent-studio-card-empty">{copy.agentCitySearchEmpty}</p>
          {/each}
        </div>
      </div>
    {:else}
    <div class="agent-studio-workspace" class:agent-studio-workspace--fallback={fallback}>
      {#if !fallback}
        <aside class="agent-city-roster" aria-label={copy.agentCityRosterTitle}>
          <header class="agent-city-roster-head">
            <span>{copy.agentCityRosterTitle}</span>
            <div class="agent-city-roster-head-right">
              {#if projection.workingCount > 0}
                <div class="agent-city-roster-filter" role="group" aria-label={copy.agentStudioActivityStatus}>
                  <button type="button" class:is-active={rosterFilter === "all"} onclick={() => (rosterFilter = "all")}>
                    {visibleAgents.length}
                  </button>
                  <button type="button" class:is-active={rosterFilter === "active"} onclick={() => (rosterFilter = "active")}>
                    {projection.workingCount}
                  </button>
                </div>
              {:else}
                <strong>{visibleAgents.length}</strong>
              {/if}
            </div>
          </header>

          <div class="agent-city-roster-search">
            <Magnifier size={13} aria-hidden="true" />
            <input
              bind:value={rosterQuery}
              type="search"
              placeholder={copy.agentCitySearchLabel}
              aria-label={copy.agentCitySearchLabel}
            />
          </div>

          <ul class="agent-city-roster-list">
            {#each filteredRosterFloors as floor (floor.key)}
              {@const action = currentFloorAction(floor)}
              {@const workerCount = floor.subagents.instances.length}
              <li
                class="agent-city-roster-item"
                class:is-selected={selectedFloorKey === floor.key}
                class:is-hovered={hoveredFloorKey === floor.key}
                data-status={floor.state}
              >
                <button
                  type="button"
                  class="agent-city-roster-row"
                  class:is-selected={selectedFloorKey === floor.key}
                  data-status={floor.state}
                  onclick={(event) => inspectFloor(floor.key, event)}
                  ondblclick={() => onOpenAgentChat(floor.agent.id)}
                  onmouseenter={() => { hoveredFloorKey = floor.key; }}
                  onmouseleave={() => { if (hoveredFloorKey === floor.key && !hoveredFloorAnchor) hoveredFloorKey = null; }}
                >
                  <div class="agent-city-roster-top">
                    <span class="agent-city-hud-dot" data-status={floor.state}></span>
                    <strong>{floor.agent.name}</strong>
                    {#if floor.state !== "idle"}
                      <small data-status={floor.state}>{statusLabel(floor.state)}</small>
                    {/if}
                  </div>
                  {#if action && (floor.state === "working" || floor.state === "error" || action.status === "waiting")}
                    <div class="agent-city-roster-action" data-status={action.status}>
                      <span>{actionKindLabel(action.kind)}</span>
                      <code>{action.name}</code>
                    </div>
                  {:else if floor.activity?.taskPreview && floor.state === "working"}
                    <p class="agent-city-roster-preview">{floor.activity.taskPreview}</p>
                  {:else}
                    <p class="agent-city-roster-desc">{floor.agent.description || copy.agentStudioNoDescription}</p>
                  {/if}
                  {#if workerCount > 0}
                    <div class="agent-city-roster-meta">
                      <span>{workerCount} {copy.agentStudioSubagents}</span>
                    </div>
                  {/if}
                </button>
                <button
                  type="button"
                  class="agent-city-roster-chat"
                  title={copy.agentCityInspectorOpenChat}
                  aria-label={`${copy.agentCityInspectorOpenChat}: ${floor.agent.name}`}
                  onclick={(event) => {
                    event.stopPropagation();
                    onOpenAgentChat(floor.agent.id);
                  }}
                >
                  {copy.agentCityInspectorOpenChat}
                </button>
              </li>
            {:else}
              <li class="agent-city-roster-empty">{copy.agentCitySearchEmpty}</li>
            {/each}
          </ul>
        </aside>
      {/if}

      <div class="agent-city-shell" class:agent-city-shell--fallback={fallback} use:observeCityShell style={`--agent-city-height:${cityHeight}px`}>
        <div class="agent-city-toolbar">
          {#if fallback || quality === "low"}
            <small>{fallback ? copy.agentCityFallbackNotice : copy.agentCityLowQuality}</small>
          {:else}
            <span></span>
          {/if}
          {#if !fallback}
            <div class="agent-city-controls">
              <button type="button" class:agent-city-control-active={searchOpen} title={copy.agentCitySearchLabel} aria-label={copy.agentCitySearchLabel} aria-expanded={searchOpen} onclick={() => searchOpen ? closeSearch() : openSearch()}>
                <Magnifier size={14} aria-hidden="true" />
              </button>
              <button type="button" class:agent-city-control-active={followWorking} title={copy.agentCityFollowWorking} aria-label={copy.agentCityFollowWorking} aria-pressed={followWorking} onclick={toggleFollow}>
                <Video size={14} aria-hidden="true" />
              </button>
              <button type="button" title={copy.agentCityZoomOut} aria-label={copy.agentCityZoomOut} onclick={() => cityCanvas?.zoom("out")}>
                <Minus size={14} aria-hidden="true" />
              </button>
              <button type="button" title={copy.agentCityZoomIn} aria-label={copy.agentCityZoomIn} onclick={() => cityCanvas?.zoom("in")}>
                <Plus size={14} aria-hidden="true" />
              </button>
              <button type="button" class:agent-city-control-active={viewAdjusted} title={copy.agentCityResetView} aria-label={copy.agentCityResetView} onclick={() => cityCanvas?.resetView()}>
                <Crosshairs size={14} aria-hidden="true" />
              </button>
            </div>
          {/if}
        </div>

        {#if fallback}
          <AgentCityFallback {projection} {copy} {statusLabel} {onOpenAgentSettings} onSelect={handleSelect} />
        {:else}
          <AgentCityCanvas
            bind:this={cityCanvas}
            {projection}
            {theme}
            {sky}
            {visualTheme}
            selectedKey={selectedFloorKey}
            onQuality={(value) => { quality = value; }}
            onFallback={handleFallback}
            onHover={handleHover}
            onSelect={handleSelect}
            onFocus={handleSelect}
            onView={handleView}
            onHud={handleHudUpdate}
          />
          <div class="agent-city-hud-layer" aria-hidden="true">
            {#each cityFloors as floor (floor.key)}
              {@const action = currentFloorAction(floor)}
              {@const satellites = hudCoords.satellites[floor.key] ?? []}
              {@const nodeLayout = hudLayout[floor.key]}
              {#if nodeLayout}
                <div
                  class="agent-city-hud-node"
                  class:is-global={floor.kind === "global"}
                  class:is-active={floor.state === "working" || floor.state === "error" || floor.state === "completed"}
                  class:is-selected={selectedFloorKey === floor.key}
                  class:is-hovered={hoveredFloorKey === floor.key}
                  class:is-compact={nodeLayout.compact}
                  class:is-dimmed={nodeLayout.dimmed}
                  data-status={floor.state}
                  style={hudNodeStyle(nodeLayout.x, nodeLayout.y, nodeLayout.zIndex)}
                >
                  <div class="agent-city-hud-badge">
                    <button
                      type="button"
                      class="agent-city-hud-main"
                      tabindex="-1"
                      onclick={(event) => inspectFloor(floor.key, event)}
                      ondblclick={() => onOpenAgentChat(floor.agent.id)}
                      onmouseenter={() => { hoveredFloorKey = floor.key; }}
                      onmouseleave={() => { if (hoveredFloorKey === floor.key && !hoveredFloorAnchor) hoveredFloorKey = null; }}
                    >
                      <span class="agent-city-hud-dot" data-status={floor.state}></span>
                      <strong>{floor.agent.name}</strong>
                      {#if floor.state !== "idle"}
                        <small>{statusLabel(floor.state)}</small>
                      {/if}
                    </button>
                  </div>

                  {#if action && (floor.state === "working" || floor.state === "error" || action.status === "waiting")}
                    <div class="agent-city-hud-action" data-kind={action.kind} data-status={action.status}>
                      <span class="agent-city-hud-action-kind">{actionKindLabel(action.kind)}</span>
                      <code>{action.name}</code>
                    </div>
                  {:else if floor.activity?.taskPreview && floor.state === "working"}
                    <div class="agent-city-hud-action" data-kind="model_call" data-status="working">
                      <code>{floor.activity.taskPreview}</code>
                    </div>
                  {/if}

                  {#if floor.subagents.groups.length > 0}
                    <div class="agent-city-hud-satellites">
                      {#each floor.subagents.groups.slice(0, 3) as group (group.role)}
                        <span
                          class="agent-city-hud-satellite-chip"
                          data-status={group.error > 0 ? "error" : group.working > 0 ? "working" : "completed"}
                        >
                          <i></i>
                          <b>{group.role}</b>
                          {#if group.total > 1}<em>×{group.total}</em>{/if}
                        </span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}

              {#each satellites as sat (sat.id)}
                {#if sat.visible}
                  <div
                    class="agent-city-hud-orbit-tag"
                    data-status={sat.status}
                    style={satelliteNodeStyle(sat.x, sat.y, sat.visible)}
                  >
                    <i></i>
                    <span>{sat.role}</span>
                  </div>
                {/if}
              {/each}
            {/each}
          </div>

          {#if telemetryFeed.length > 0}
            <div class="agent-city-telemetry-bar" aria-label={copy.agentCityTelemetryTitle}>
              <span class="agent-city-telemetry-kicker">
                <i></i>
                {copy.agentCityTelemetryTitle}
              </span>
              <div class="agent-city-telemetry-track">
                {#each telemetryFeed as item (item.id)}
                  <button
                    type="button"
                    class="agent-city-telemetry-item"
                    data-status={item.status}
                    onclick={() => {
                      selectedFloorKey = item.floorKey;
                      cityCanvas?.focusFloor(item.floorKey);
                    }}
                  >
                    <time>{activityTime(item.time)}</time>
                    <strong>{item.agentName}</strong>
                    <span>{actionKindLabel(item.kind)}</span>
                    <code>{item.name}</code>
                  </button>
                {/each}
              </div>
            </div>
          {:else}
            <p class="agent-city-hint">{copy.agentCityInteractionHint}</p>
          {/if}

          {#if searchOpen}
            <div class="agent-city-search" class:agent-city-search--with-inspector={Boolean(selectedFloor)}>
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

          {#if hoveredFloor && hoveredFloor.key !== selectedFloorKey && hoverCardPos}
            <div class="agent-city-hover-card" style={hoverCardStyle(hoverCardPos)}>
              <div class="agent-city-hover-head">
                <strong>{hoveredFloor.agent.name}</strong>
                <span data-status={hoveredFloor.state}>{statusLabel(hoveredFloor.state)}</span>
              </div>
              <p>{hoveredFloor.agent.description || copy.agentStudioNoDescription}</p>
              {#if hoveredFloor.activity}
                <small>{shortBotName(hoveredFloor.activity.botName)} · {channelLabel(hoveredFloor.activity.channel)} · {activityTime(hoveredFloor.activity.startedAt)}</small>
                <p class="agent-city-hover-task">{hoveredFloor.activity.taskPreview || copy.agentStudioTaskUnavailable}</p>
              {/if}
              <em>{hoveredFloor.agent.modelOverrides > 0 ? `${hoveredFloor.agent.modelOverrides} ${copy.agentStudioModelRoutes}` : copy.agentStudioDefaultRoute}</em>
              {#if hoveredFloor.subagents.instances.length}
                <small>{hoveredFloor.subagents.instances.length} {copy.agentStudioSubagents} · {subagentSummary(hoveredFloor)}</small>
              {/if}
            </div>
          {/if}

          <div class="sr-only">
            <p>{copy.agentStudioSummary}</p>
            <p>{projection.workingCount} {copy.agentStudioWorkingCount}</p>
            <p>{activeWorkerCount} {copy.agentStudioWorkers}</p>
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

        {#if selectedFloor}
          <AgentCityInspector
            floor={selectedFloor}
            {copy}
            {statusLabel}
            {channelLabel}
            {activityTime}
            onClose={closeSelection}
            onFocus={() => selectedFloorKey && cityCanvas?.focusFloor(selectedFloorKey)}
            canFocus={!fallback}
            onOpenChat={onOpenAgentChat}
            onOpenSettings={onOpenAgentSettings}
          />
        {/if}

        {#if projection.hiddenAgentCount > 0}
          <p class="agent-city-overflow"><strong>+{projection.hiddenAgentCount}</strong> {copy.agentCityOverflow}</p>
        {/if}
      </div>
    </div>
    {/if}

    <section class="agent-studio-runs-panel" aria-label={copy.agentStudioRecentActivityTitle}>
      <header class="agent-studio-runs-head">
        <h3>{copy.agentStudioRecentActivityTitle}</h3>
        {#if recentRunsFeed.length > 0}
          <span>{recentRunsFeed.length}</span>
        {/if}
      </header>
      {#if recentRunsFeed.length > 0}
        <ul class="agent-studio-runs-list">
          {#each recentRunsFeed as item (item.runId)}
            <li>
              <button
                type="button"
                class="agent-studio-run-row"
                onclick={() => onOpenAgentChat(item.agentId)}
              >
                <span class="agent-city-hud-dot" data-status={item.status}></span>
                <strong class="agent-studio-run-agent">{item.agentName}</strong>
                <span class="agent-studio-run-task">{item.taskPreview}</span>
                <span class="agent-studio-run-meta">
                  {channelLabel(item.channel)}
                  {#if item.toolCalls > 0}· {item.toolCalls} {copy.agentCityMetricTools}{/if}
                  {#if item.subagentCount > 0}· {item.subagentCount} {copy.agentStudioSubagents}{/if}
                </span>
                <time>{activityTime(item.startedAt)}</time>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="agent-studio-quick-dispatch">
          <p>{copy.agentStudioQuickDispatchHint}</p>
          <div class="agent-studio-quick-chips">
            {#each rosterFloors.slice(0, 6) as floor (floor.key)}
              <button type="button" onclick={() => onOpenAgentChat(floor.agent.id)}>
                <span class="agent-city-hud-dot" data-status={floor.state}></span>
                <strong>{floor.agent.name}</strong>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if activityError}<p class="agent-studio-error" role="alert">{activityError}</p>{/if}
</section>
