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
    statusDots = new Map<string, SessionStatusDot>(),
    formatTime,
    onNewConversation,
    onOpenProjects,
    onOpenAutoTasks,
    onOpenSkills,
    onOpenSettings,
    onToggleChannel,
    onSelectSession,
    onStopSession,
    onMoreChannel
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
    };
    channels: ChannelDescriptor[];
    expandedChannel: string;
    expandedItems?: DesktopConversationItem[];
    expandedHasMore?: boolean;
    expandedLoading?: boolean;
    activeSessionId?: string;
    statusDots?: Map<string, SessionStatusDot>;
    formatTime: (iso: string) => string;
    onNewConversation: () => void;
    onOpenProjects: () => void;
    onOpenAutoTasks: () => void;
    onOpenSkills: () => void;
    onOpenSettings: () => void;
    onToggleChannel: (channel: string) => void;
    onSelectSession: (item: DesktopConversationItem) => void;
    onStopSession: (item: DesktopConversationItem) => void;
    onMoreChannel: (channel: string) => void;
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
    goToSettings: copy.goToSettings
  });
</script>

<aside class="chat-sidebar">
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
        onStop={onStopSession}
        onMore={() => onMoreChannel(channel.id)}
        onConfigure={onOpenSettings}
      />
    {/each}
  </div>

  <button type="button" class="sidebar-footer" onclick={onOpenSettings} title={copy.goToSettings}>
    <span class="sidebar-footer-logo" aria-hidden="true">M</span>
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
    padding: 6px 6px 8px;
    border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.06));
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    color: inherit;
    text-align: left;
    font-size: 13px;
  }
  .nav-item:hover { background: var(--fill-hover, rgba(0, 0, 0, 0.04)); }
  .nav-item i { font-size: 16px; opacity: 0.85; }
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
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-top: 1px solid var(--border, rgba(0, 0, 0, 0.06));
    background: transparent;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }
  .sidebar-footer:hover { background: var(--fill-hover, rgba(0, 0, 0, 0.04)); }
  .sidebar-footer-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--accent, #006bff);
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    flex: 0 0 auto;
  }
  .sidebar-footer-name { flex: 1 1 auto; font-weight: 600; font-size: 13px; }
  .sidebar-footer-gear { opacity: 0.6; font-size: 16px; }
</style>
