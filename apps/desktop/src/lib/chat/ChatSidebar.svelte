<script lang="ts">
  import ChannelAccordion, { type ChannelDescriptor } from "./ChannelAccordion.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { SessionStatusDot } from "./sessionStatusDot.js";

  let {
    copy,
    channels,
    expandedChannel,
    expandedItems = [],
    expandedHasMore = false,
    expandedLoading = false,
    activeSessionId = "",
    serviceState = "disconnected",
    statusDots = new Map<string, SessionStatusDot>(),
    formatTime,
    onNewConversation,
    onOpenProjects,
    onOpenAutoTasks,
    onOpenSkills,
    onOpenSettings,
    onToggleChannel,
    onSelectSession,
    onMoreChannel,
    onRenameSession,
    onDeleteSession
  }: {
    copy: {
      appName: string;
      newChat: string;
      projects: string;
      autoTasks: string;
      skillsSquare: string;
      running: string;
      waitingApproval: string;
      completed: string;
      failed: string;
      more: string;
      emptyWeb: string;
      emptyExternal: string;
      notConfigured: string;
      goToSettings: string;
      conversationMenu: string;
      renameConversation: string;
      deleteConversation: string;
      renamePlaceholder: string;
      deleteConversationPrompt: string;
      cancelAction: string;
    };
    channels: ChannelDescriptor[];
    expandedChannel: string;
    expandedItems?: DesktopConversationItem[];
    expandedHasMore?: boolean;
    expandedLoading?: boolean;
    activeSessionId?: string;
    serviceState?: "disconnected" | "ready" | "incompatible" | "error";
    statusDots?: Map<string, SessionStatusDot>;
    formatTime: (iso: string) => string;
    onNewConversation: () => void;
    onOpenProjects: () => void;
    onOpenAutoTasks: () => void;
    onOpenSkills: () => void;
    onOpenSettings: () => void;
    onToggleChannel: (channel: string) => void;
    onSelectSession: (item: DesktopConversationItem) => void;
    onMoreChannel: (channel: string) => void;
    onRenameSession: (item: DesktopConversationItem, title: string) => void;
    onDeleteSession: (item: DesktopConversationItem) => void;
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
    <button type="button" class="nav-item" onclick={onOpenProjects}>
      <i class="ph-fill ph-folders" aria-hidden="true"></i>
      <span>{copy.projects}</span>
    </button>
    <button type="button" class="nav-item" onclick={onOpenAutoTasks}>
      <i class="ph-fill ph-clock-countdown" aria-hidden="true"></i>
      <span>{copy.autoTasks}</span>
    </button>
    <button type="button" class="nav-item" onclick={onOpenSkills}>
      <i class="ph-fill ph-sparkle" aria-hidden="true"></i>
      <span>{copy.skillsSquare}</span>
    </button>
  </nav>

  <div class="sidebar-channels">
    {#each channels as channel (channel.id)}
      <ChannelAccordion
        {channel}
        expanded={channel.id === expandedChannel}
        items={channel.id === expandedChannel ? expandedItems : []}
        hasMore={channel.id === expandedChannel ? expandedHasMore : false}
        loading={channel.id === expandedChannel ? expandedLoading : false}
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
  </div>

  <button type="button" class="sidebar-footer" onclick={onOpenSettings} title={copy.goToSettings}>
    <span class="sidebar-footer-logo-wrap" data-state={serviceState} aria-hidden="true">
      <img class="sidebar-footer-logo" src="/molibot-icon.png" alt="" />
    </span>
    <span class="sidebar-footer-name">{copy.appName}</span>
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
    margin-bottom: 6px;
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
    transition: background 0.12s ease;
  }
  .nav-item:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .nav-item i { font-size: 16px; color: var(--label-secondary, #666); }
  .sidebar-channels {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 2px 0;
    min-height: 0;
  }
  .sidebar-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    width: calc(100% + 24px);
    height: 46px;
    margin: auto -12px -8px;
    padding: 0 22px;
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
  .sidebar-footer-name { flex: 1 1 auto; font-weight: 600; font-size: 13px; }
  .sidebar-footer-gear { opacity: 0.6; font-size: 16px; }
</style>
