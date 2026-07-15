<script lang="ts">
  import ChannelAccordion, { type ChannelDescriptor } from "./ChannelAccordion.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";
  import ProjectTree from "../projects/ProjectTree.svelte";
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
    onActivateProjectSession
  }: {
    copy: Translation;
    channels: ChannelDescriptor[];
    conversationsExpanded: boolean;
    projectsExpanded: boolean;
    activeWorkspacePane?: "chat" | "automations" | "skills" | "agents";
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
    cancel: copy.cancelAction
  });
</script>

<aside class="chat-sidebar">
  <div class="sidebar-titlebar-drag" data-tauri-drag-region aria-hidden="true"></div>
  <nav class="sidebar-nav" aria-label={copy.newChat}>
    <button type="button" class="nav-item" onclick={onNewConversation}>
      <i class="ph-fill ph-plus-circle" aria-hidden="true"></i>
      <span>{copy.newChat}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "automations"} aria-current={activeWorkspacePane === "automations" ? "page" : undefined} onclick={onOpenAutoTasks}>
      <i class="ph-fill ph-clock-countdown" aria-hidden="true"></i>
      <span>{copy.autoTasks}</span>
      {#if automationUnreadCount > 0}<span class="nav-notification" aria-label={`${automationUnreadCount} ${copy.tasksReminderUnread}`}>{automationUnreadCount > 99 ? "99+" : automationUnreadCount}</span>{/if}
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "skills"} aria-current={activeWorkspacePane === "skills" ? "page" : undefined} onclick={onOpenSkills}>
      <i class="ph-fill ph-sparkle" aria-hidden="true"></i>
      <span>{copy.skillsSquare}</span>
    </button>
    <button type="button" class="nav-item" class:active={activeWorkspacePane === "agents"} aria-current={activeWorkspacePane === "agents" ? "page" : undefined} onclick={onOpenAgents}>
      <i class="ph-fill ph-dog" aria-hidden="true"></i>
      <span>{copy.agentsNav}</span>
    </button>
  </nav>

  <div class="sidebar-channels">
    <section class="sidebar-tree-section">
      <button type="button" class="sidebar-tree-title" aria-expanded={conversationsExpanded} onclick={onToggleConversations}>
        <span>{copy.chat}</span><i class="ph ph-caret-right sidebar-tree-caret" class:open={conversationsExpanded} aria-hidden="true"></i>
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
    height: 100%;
    min-height: 0;
  }
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 0 8px;
    margin-bottom: 0;
    border-bottom: 1px solid var(--separator, rgba(0, 0, 0, 0.06));
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: var(--rounded-sm, 6px);
    cursor: pointer;
    color: var(--label-primary, #171717);
    text-align: left;
    font-size: 13px;
    transition: background var(--duration-instant) var(--ease-standard);
  }
  .nav-item:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .nav-item.active { background: var(--fill, rgba(0, 0, 0, 0.05)); color: var(--label-primary, #171717); font-weight: 600; }
  .nav-item.active i { color: var(--accent, #006bff); }
  .nav-item i { font-size: 16px; color: var(--label-secondary, #666); }
  .nav-notification { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; margin-left: auto; padding: 0 5px; border-radius: 9999px; background: var(--accent, #006bff); color: #fff; font-size: 10px; font-weight: 650; font-variant-numeric: tabular-nums; }
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
  .sidebar-tree-title { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 0 8px; border: 0; background: transparent; color: var(--label-secondary); font: inherit; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer; }
  .sidebar-tree-title:hover { color: var(--label-primary); }
  .sidebar-tree-title span { flex: 1; }
  .sidebar-tree-caret { opacity: 0; font-size: 11px; color: var(--label-tertiary); transition: opacity var(--duration-instant) var(--ease-standard), transform var(--duration-instant) var(--ease-standard); }
  .sidebar-tree-title:hover .sidebar-tree-caret, .sidebar-tree-title:focus-visible .sidebar-tree-caret { opacity: 1; }
  .sidebar-tree-caret.open { transform: rotate(90deg); }
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
  .sidebar-footer-copy strong { overflow: hidden; font-weight: 600; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar-footer-copy small { color: var(--label-secondary, #666); font-size: 11px; }
  .sidebar-footer-gear { opacity: 0.6; font-size: 16px; }
</style>
