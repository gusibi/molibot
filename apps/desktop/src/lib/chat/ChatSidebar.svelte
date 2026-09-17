<script lang="ts">
  import CalendarDays from "../icons/duotone/components/CalendarDays.svelte";
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import Grid from "../icons/duotone/components/Grid.svelte";
  import Layers from "../icons/duotone/components/Layers.svelte";
  import Pen from "../icons/duotone/components/Pen.svelte";
  import RulerPen from "../icons/duotone/components/RulerPen.svelte";
  import TuningSquare2 from "../icons/duotone/components/TuningSquare2.svelte";
  import Vacuum2 from "../icons/duotone/components/Vacuum2.svelte";
  import ChannelAccordion, { type ChannelDescriptor } from "./ChannelAccordion.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";
  import ProjectTree from "../projects/ProjectTree.svelte";
  import type { Translation } from "../i18n";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let {
    copy,
    channels,
    conversationsExpanded,
    projectsExpanded,
    activeWorkspacePane = "chat",
    automationUnreadCount = 0,
    expandedChannels,
    channelItems,
    channelHasMore,
    channelLoading,
    channelLoadingMore,
    activeSessionId = "",
    activeProjectSessionId = "",
    endpoint,
    serviceState = "disconnected",
    statusDots = new Map<string, SessionStatusDot>(),
    formatTime,
    onNewConversation,
    onOpenAutoTasks,
    onOpenSkills,
    onOpenAgents,
    onOpenPlans,
    onOpenSettings,
    onToggleConversations,
    onToggleProjects,
    onToggleChannel,
    onSelectSession,
    onMoreChannel,
    onRenameSession,
    onDeleteSession,
    onCopySessionPath,
    onRevealSessionInFinder,
    onActivateProjectSession,
    onOpenMiniApps
  }: {
    copy: Translation;
    channels: ChannelDescriptor[];
    conversationsExpanded: boolean;
    projectsExpanded: boolean;
    activeWorkspacePane?: "chat" | "automations" | "skills" | "agents" | "miniapps" | "plans";
    automationUnreadCount?: number;
    expandedChannels: Record<string, boolean>;
    channelItems: Record<string, DesktopConversationItem[]>;
    channelHasMore: Record<string, boolean>;
    channelLoading: Record<string, boolean>;
    channelLoadingMore: Record<string, boolean>;
    activeSessionId?: string;
    activeProjectSessionId?: string;
    endpoint: string;
    serviceState?: "disconnected" | "ready" | "incompatible" | "error";
    statusDots?: Map<string, SessionStatusDot>;
    formatTime: (iso: string) => string;
    onNewConversation: () => void;
    onOpenAutoTasks: () => void;
    onOpenSkills: () => void;
    onOpenAgents: () => void;
    onOpenPlans: () => void;
    onOpenSettings: () => void;
    onToggleConversations: () => void;
    onToggleProjects: () => void;
    onToggleChannel: (channel: string) => void;
    onSelectSession: (item: DesktopConversationItem) => void;
    onMoreChannel: (channel: string) => void;
    onRenameSession: (item: DesktopConversationItem, title: string) => void;
    onDeleteSession: (item: DesktopConversationItem) => void;
    onCopySessionPath?: (item: DesktopConversationItem) => void | Promise<void>;
    onRevealSessionInFinder?: (item: DesktopConversationItem) => void | Promise<void>;
    onActivateProjectSession: () => void;
    onOpenMiniApps: () => void;
  } = $props();

  const accordionLabels = $derived({
    running: copy.running,
    waitingApproval: copy.waitingApproval,
    completed: copy.completed,
    failed: copy.failed,
    more: copy.more,
    emptyWeb: copy.emptyWeb,
    emptyExternal: copy.emptyExternal,
    notConfigured: copy.notConfigured,
    goToSettings: copy.goToSettings,
    menu: copy.conversationMenu,
    rename: copy.renameConversation,
    delete: copy.deleteConversation,
    copyPath: copy.copySessionPath,
    revealInFinder: copy.openInFinder,
    renamePlaceholder: copy.renamePlaceholder,
    deletePrompt: copy.deleteConversationPrompt,
    cancel: copy.cancelAction,
    forkedConversation: copy.forkedConversation,
    newChat: copy.newChat,
    loading: copy.loading
  });

  function startWindowDrag(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging().catch((error) => console.error("window drag failed", error));
  }
</script>

<aside class="chat-sidebar" data-theme-region="sidebar">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sidebar-titlebar-drag" data-tauri-drag-region aria-hidden="true" onmousedown={startWindowDrag}></div>
  <nav class="sidebar-nav" aria-label={copy.newChat}>
    <button type="button" class="nav-item" onclick={onNewConversation}>
      <Pen size={16} aria-hidden="true" />
      <span>{copy.newChat}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "automations"} aria-current={activeWorkspacePane === "automations" ? "page" : undefined} onclick={onOpenAutoTasks}>
      <CalendarDays size={16} aria-hidden="true" />
      <span>{copy.autoTasks}</span>
      {#if automationUnreadCount > 0}<span class="nav-notification" aria-label={`${automationUnreadCount} ${copy.tasksReminderUnread}`}>{automationUnreadCount > 99 ? "99+" : automationUnreadCount}</span>{/if}
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "skills"} aria-current={activeWorkspacePane === "skills" ? "page" : undefined} onclick={onOpenSkills}>
      <RulerPen size={16} aria-hidden="true" />
      <span>{copy.skillsSquare}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "agents"} aria-current={activeWorkspacePane === "agents" ? "page" : undefined} onclick={onOpenAgents}>
      <Vacuum2 size={16} aria-hidden="true" />
      <span>{copy.agentsNav}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "plans"} aria-current={activeWorkspacePane === "plans" ? "page" : undefined} onclick={onOpenPlans}>
      <Layers size={16} aria-hidden="true" />
      <span>{copy.planBoardNav}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "miniapps"} aria-current={activeWorkspacePane === "miniapps" ? "page" : undefined} onclick={onOpenMiniApps}>
      <Grid size={16} aria-hidden="true" />
      <span>{copy.miniAppsNav}</span>
    </button>
  </nav>

  <div class="sidebar-channels" data-theme-region="session-list">
    <section class="sidebar-tree-section">
      <button type="button" class="sidebar-section-head sidebar-section-toggle" aria-expanded={conversationsExpanded} onclick={onToggleConversations}>
        <span>{copy.chat}</span><i aria-hidden="true"><CaretRight class={conversationsExpanded ? "sidebar-section-caret open" : "sidebar-section-caret"} size={12} /></i>
      </button>
      {#if conversationsExpanded}
        {#each channels as channel (channel.id)}
          <ChannelAccordion
            {channel}
            expanded={Boolean(expandedChannels[channel.id])}
            items={channelItems[channel.id] ?? []}
            hasMore={Boolean(channelHasMore[channel.id])}
            loading={Boolean(channelLoading[channel.id])}
            loadingMore={Boolean(channelLoadingMore[channel.id])}
            {activeSessionId}
            {statusDots}
            labels={accordionLabels}
            {formatTime}
            onToggle={() => onToggleChannel(channel.id)}
            onNewSession={channel.id === "web" ? onNewConversation : null}
            onSelect={onSelectSession}
            onMore={() => onMoreChannel(channel.id)}
            onConfigure={onOpenSettings}
            onRenameItem={onRenameSession}
            onDeleteItem={onDeleteSession}
            onCopySessionPath={onCopySessionPath}
            onRevealSessionInFinder={onRevealSessionInFinder}
          />
        {/each}
      {/if}
    </section>
    <section class="sidebar-tree-section">
      <ProjectTree {copy} {endpoint} expanded={projectsExpanded} activeSessionId={activeProjectSessionId} {formatTime} onToggle={onToggleProjects} onActivateSession={onActivateProjectSession} />
    </section>
  </div>

  <!-- The avatar's status dot already carries the service state visually, so the
       redundant 在线/离线 line is gone; its text stays as the button's
       accessible name so status never depends on colour alone. -->
  <button
    type="button"
    class="sidebar-footer"
    aria-label={`${copy.appName} · ${serviceState === "ready" ? copy.statusOnline : copy.statusOffline}`}
    onclick={onOpenSettings}
    title={copy.goToSettings}
  >
    <span class="sidebar-footer-logo-wrap" data-state={serviceState} aria-hidden="true">
      <img class="sidebar-footer-logo" src="/molibot-icon.png" alt="" width="20" height="20" />
    </span>
    <span class="sidebar-footer-copy"><strong>{copy.appName}</strong></span>
    <TuningSquare2 class="sidebar-footer-gear" size={16} aria-hidden="true" />
  </button>
</aside>

<style>
  .chat-sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    gap: 2px;
    padding: 0 0 6px;
    margin-bottom: 0;
    border-bottom: 0;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: none;
    background: transparent;
    border-radius: var(--rounded-sm, 6px);
    cursor: pointer;
    color: var(--label-primary, #171717);
    text-align: left;
    font-size: var(--fs-label);
    transition: background var(--duration-instant) var(--ease-standard);
  }
  .nav-item:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .nav-item.active { background: var(--fill, rgba(0, 0, 0, 0.05)); color: var(--label-primary, #171717); font-weight: 600; }
  .nav-item.active :global(svg) { color: var(--accent, #006bff); }
  .nav-item :global(svg) { color: var(--label-secondary, #666); }
  .nav-notification { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; margin-left: auto; padding: 0 5px; border-radius: var(--radius-full, 999px); background: var(--accent, #006bff); color: var(--on-accent); font-size: var(--fs-meta); font-weight: 600; font-variant-numeric: tabular-nums; }
  .sidebar-channels {
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    /* Bleed the scroll container to the sidebar's inner right edge so the
       scrollbar sits flush against the divider; padding keeps content aligned. */
    margin-right: -12px;
    padding: 0 12px 0 0;
    min-height: 0;
  }
  .sidebar-tree-section { min-width: 0; padding: 0 0 8px; }
  .sidebar-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    height: 48px;
    /* Bleed to the sidebar's inner edges so the hover background and top border
       span full width; padding restores the content's original inset. */
    margin: auto -12px -8px;
    padding: 0 20px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }
  .sidebar-footer:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .sidebar-footer-logo-wrap {
    position: relative;
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }
  .sidebar-footer-logo-wrap::after {
    content: "";
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 8px;
    height: 8px;
    border: 2px solid var(--sidebar-bg, #fff);
    border-radius: 50%;
    background: var(--gray-700, #8a8a8a);
  }
  .sidebar-footer-logo-wrap[data-state="ready"]::after { background: var(--online, #28a745); }
  .sidebar-footer-logo-wrap[data-state="error"]::after,
  .sidebar-footer-logo-wrap[data-state="incompatible"]::after { background: var(--danger, #ff453a); }
  .sidebar-footer-logo {
    display: block;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
  }
  .sidebar-footer-copy { display: grid; flex: 1 1 auto; gap: 1px; min-width: 0; }
  .sidebar-footer-copy strong { overflow: hidden; font-weight: 600; font-size: var(--fs-label); text-overflow: ellipsis; white-space: nowrap; }
  /* The gear is a control, not metadata: it reads at the secondary label rank at
     full strength so it stops disappearing into the footer. */
  .sidebar-footer :global(.sidebar-footer-gear) { color: var(--label-secondary, #666); opacity: 1; }
  .sidebar-footer:hover :global(.sidebar-footer-gear) { color: var(--label-primary, #171717); }
</style>
