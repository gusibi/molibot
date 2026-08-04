<script lang="ts">
  import ChannelAccordion, { type ChannelDescriptor } from "./ChannelAccordion.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";
  import ProjectTree from "../projects/ProjectTree.svelte";
  import MiniAppsSidebarSection from "../miniapps/MiniAppsSidebarSection.svelte";
  import type { Translation } from "../i18n";

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
    onOpenSettings,
    onToggleConversations,
    onToggleProjects,
    onToggleChannel,
    onSelectSession,
    onMoreChannel,
    onRenameSession,
    onDeleteSession,
    onActivateProjectSession,
    miniAppsExpanded = true,
    activeMiniAppId = "",
    onToggleMiniApps,
    onOpenMiniApp,
    onOpenMiniApps
  }: {
    copy: Translation;
    channels: ChannelDescriptor[];
    conversationsExpanded: boolean;
    projectsExpanded: boolean;
    activeWorkspacePane?: "chat" | "automations" | "skills" | "agents" | "miniapps";
    automationUnreadCount?: number;
    expandedChannels: Record<string, boolean>;
    channelItems: Record<string, DesktopConversationItem[]>;
    channelHasMore: Record<string, boolean>;
    channelLoading: Record<string, boolean>;
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
    onOpenSettings: () => void;
    onToggleConversations: () => void;
    onToggleProjects: () => void;
    onToggleChannel: (channel: string) => void;
    onSelectSession: (item: DesktopConversationItem) => void;
    onMoreChannel: (channel: string) => void;
    onRenameSession: (item: DesktopConversationItem, title: string) => void;
    onDeleteSession: (item: DesktopConversationItem) => void;
    onActivateProjectSession: () => void;
    miniAppsExpanded?: boolean;
    activeMiniAppId?: string;
    onToggleMiniApps: () => void;
    onOpenMiniApp: (appId: string) => void;
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
    renamePlaceholder: copy.renamePlaceholder,
    deletePrompt: copy.deleteConversationPrompt,
    cancel: copy.cancelAction,
    forkedConversation: copy.forkedConversation
  });

  function trackStickySectionHeads(node: HTMLElement) {
    let animationFrame = 0;

    const update = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const containerTop = node.getBoundingClientRect().top;
        for (const head of node.querySelectorAll<HTMLElement>(".sidebar-section-head")) {
          const section = head.closest<HTMLElement>(".sidebar-tree-section");
          const headRect = head.getBoundingClientRect();
          const sectionRect = section?.getBoundingClientRect();
          const isStuck = node.scrollTop > 0
            && Math.abs(headRect.top - containerTop) <= 1
            && Boolean(sectionRect && sectionRect.bottom > containerTop + headRect.height);
          head.classList.toggle("is-stuck", isStuck);
        }
      });
    };

    node.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(node);
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(node, { childList: true, subtree: true });
    update();

    return {
      destroy() {
        cancelAnimationFrame(animationFrame);
        node.removeEventListener("scroll", update);
        resizeObserver.disconnect();
        mutationObserver.disconnect();
      }
    };
  }
</script>

<aside class="chat-sidebar">
  <div class="sidebar-titlebar-drag" data-tauri-drag-region aria-hidden="true"></div>
  <nav class="sidebar-nav" aria-label={copy.newChat}>
    <button type="button" class="nav-item" onclick={onNewConversation}>
      <i class="ph ph-note-pencil" aria-hidden="true"></i>
      <span>{copy.newChat}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "automations"} aria-current={activeWorkspacePane === "automations" ? "page" : undefined} onclick={onOpenAutoTasks}>
      <i class="ph ph-calendar-dots" aria-hidden="true"></i>
      <span>{copy.autoTasks}</span>
      {#if automationUnreadCount > 0}<span class="nav-notification" aria-label={`${automationUnreadCount} ${copy.tasksReminderUnread}`}>{automationUnreadCount > 99 ? "99+" : automationUnreadCount}</span>{/if}
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "skills"} aria-current={activeWorkspacePane === "skills" ? "page" : undefined} onclick={onOpenSkills}>
      <i class="ph ph-puzzle-piece" aria-hidden="true"></i>
      <span>{copy.skillsSquare}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "agents"} aria-current={activeWorkspacePane === "agents" ? "page" : undefined} onclick={onOpenAgents}>
      <i class="ph ph-robot" aria-hidden="true"></i>
      <span>{copy.agentsNav}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "miniapps"} aria-current={activeWorkspacePane === "miniapps" ? "page" : undefined} onclick={onOpenMiniApps}>
      <i class="ph ph-app-store-logo" aria-hidden="true"></i>
      <span>{copy.miniAppsNav}</span>
    </button>
  </nav>

  <div class="sidebar-channels" use:trackStickySectionHeads>
    <section class="sidebar-tree-section">
      <button type="button" class="sidebar-section-head sidebar-section-toggle" aria-expanded={conversationsExpanded} onclick={onToggleConversations}>
        <span>{copy.chat}</span><i class="ph ph-caret-right sidebar-section-caret" class:open={conversationsExpanded} aria-hidden="true"></i>
      </button>
      {#if conversationsExpanded}
        {#each channels as channel (channel.id)}
          <ChannelAccordion
            {channel}
            expanded={Boolean(expandedChannels[channel.id])}
            items={channelItems[channel.id] ?? []}
            hasMore={Boolean(channelHasMore[channel.id])}
            loading={Boolean(channelLoading[channel.id])}
            {activeSessionId}
            {statusDots}
            labels={accordionLabels}
            {formatTime}
            onToggle={() => onToggleChannel(channel.id)}
            onSelect={onSelectSession}
            onMore={() => onMoreChannel(channel.id)}
            onConfigure={onOpenSettings}
            onRenameItem={onRenameSession}
            onDeleteItem={onDeleteSession}
          />
        {/each}
      {/if}
    </section>
    <section class="sidebar-tree-section">
      <ProjectTree {copy} {endpoint} expanded={projectsExpanded} activeSessionId={activeProjectSessionId} {formatTime} onToggle={onToggleProjects} onActivateSession={onActivateProjectSession} />
    </section>
    <section class="sidebar-tree-section">
      <MiniAppsSidebarSection
        {copy}
        {endpoint}
        expanded={miniAppsExpanded}
        activeAppId={activeMiniAppId}
        onToggle={onToggleMiniApps}
        onOpenApp={onOpenMiniApp}
        onSeeAll={onOpenMiniApps}
      />
    </section>
  </div>

  <button type="button" class="sidebar-footer" onclick={onOpenSettings} title={copy.goToSettings}>
    <span class="sidebar-footer-logo-wrap" data-state={serviceState} aria-hidden="true">
      <img class="sidebar-footer-logo" src="/molibot-icon.png" alt="" />
    </span>
    <span class="sidebar-footer-copy"><strong>{copy.appName}</strong><small>{serviceState === "ready" ? copy.statusOnline : copy.statusOffline}</small></span>
    <i class="ph ph-gear-six sidebar-footer-gear" aria-hidden="true"></i>
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
  .nav-item.active i { color: var(--accent, #006bff); }
  .nav-item i { width: 16px; font-size: var(--icon-md); color: var(--label-secondary, #666); text-align: center; }
  .nav-notification { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; margin-left: auto; padding: 0 5px; border-radius: var(--radius-full, 999px); background: var(--accent, #006bff); color: #fff; font-size: var(--fs-meta); font-weight: 600; font-variant-numeric: tabular-nums; }
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
    border-top: 1px solid var(--separator, rgba(0, 0, 0, 0.06));
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
  .sidebar-footer-copy small { color: var(--label-secondary, #666); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .sidebar-footer-gear { opacity: 0.6; font-size: var(--icon-md); }
</style>
