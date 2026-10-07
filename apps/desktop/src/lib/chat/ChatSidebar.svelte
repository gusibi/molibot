<script lang="ts">
  import ChatRoundLine from "../icons/duotone/components/ChatRoundLine.svelte";
  import Dialog from "../icons/duotone/components/Dialog.svelte";
  import Pen from "../icons/duotone/components/Pen.svelte";
  import RulerPen from "../icons/duotone/components/RulerPen.svelte";
  import Users2 from "../icons/duotone/components/Users2.svelte";
  import Widget2 from "../icons/duotone/components/Widget2.svelte";
  import Bulb2 from "reicon-svelte/icons/Bulb2";
  import Package from "reicon-svelte/icons/Package";
  import SendClock from "reicon-svelte/icons/SendClock";
  import Settings2 from "reicon-svelte/icons/Settings2";
  import SidebarLists, { type SidebarListSection } from "./SidebarLists.svelte";
  import type { ChannelDescriptor } from "./ChannelAccordion.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { AgentRoom } from "@molibot/shared/rooms";
  import type { SessionStatusDot } from "./sessionStatusDot.js";
  import type { Translation } from "../i18n";

  let {
    copy,
    channels,
    conversationsExpanded,
    projectsExpanded,
    roomsExpanded,
    activeWorkspacePane = "chat",
    automationUnreadCount = 0,
    expandedChannels,
    channelItems,
    channelHasMore,
    channelLoading,
    channelLoadingMore,
    activeSessionId = "",
    activeProjectSessionId = "",
    activeRoomId = "",
    rooms = [],
    roomMeta = () => "",
    endpoint,
    serviceState = "disconnected",
    statusDots = new Map<string, SessionStatusDot>(),
    formatTime,
    collapsed = false,
    collapsedFlyout = null,
    onToggleFlyout,
    onNewConversation,
    roomsLabel,
    roomsCreateLabel,
    roomsEmptyLabel,
    onOpenAutoTasks,
    onOpenSkills,
    onOpenAgents,
    onOpenPlans,
    onOpenSettings,
    onOpenConversations,
    onOpenProjects,
    onOpenRooms,
    onToggleConversations,
    onToggleProjects,
    onToggleRooms,
    onToggleChannel,
    onSelectSession,
    onSelectRoom,
    onCreateRoom,
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
    roomsExpanded: boolean;
    activeWorkspacePane?: "chat" | "automations" | "skills" | "agents" | "miniapps" | "plans";
    automationUnreadCount?: number;
    expandedChannels: Record<string, boolean>;
    channelItems: Record<string, DesktopConversationItem[]>;
    channelHasMore: Record<string, boolean>;
    channelLoading: Record<string, boolean>;
    channelLoadingMore: Record<string, boolean>;
    activeSessionId?: string;
    activeProjectSessionId?: string;
    activeRoomId?: string;
    rooms?: AgentRoom[];
    roomMeta?: (room: AgentRoom) => string;
    endpoint: string;
    serviceState?: "disconnected" | "ready" | "incompatible" | "error";
    statusDots?: Map<string, SessionStatusDot>;
    formatTime: (iso: string) => string;
    collapsed?: boolean;
    collapsedFlyout?: SidebarListSection | null;
    onToggleFlyout?: (section: SidebarListSection) => void;
    onNewConversation: () => void;
    roomsLabel: string;
    roomsCreateLabel: string;
    roomsEmptyLabel: string;
    onOpenAutoTasks: () => void;
    onOpenSkills: () => void;
    onOpenAgents: () => void;
    onOpenPlans: () => void;
    onOpenSettings: () => void;
    onOpenConversations: () => void;
    onOpenProjects: () => void;
    onOpenRooms: () => void;
    onToggleConversations: () => void;
    onToggleProjects: () => void;
    onToggleRooms: () => void;
    onToggleChannel: (channel: string) => void;
    onSelectSession: (item: DesktopConversationItem) => void;
    onSelectRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onMoreChannel: (channel: string) => void;
    onRenameSession: (item: DesktopConversationItem, title: string) => void;
    onDeleteSession: (item: DesktopConversationItem) => void;
    onCopySessionPath?: (item: DesktopConversationItem) => void | Promise<void>;
    onRevealSessionInFinder?: (item: DesktopConversationItem) => void | Promise<void>;
    onActivateProjectSession: () => void;
    onOpenMiniApps: () => void;
  } = $props();

  const workspaceItems = $derived([
    { key: "automations", label: copy.autoTasks, icon: SendClock, active: activeWorkspacePane === "automations", badge: automationUnreadCount, onSelect: onOpenAutoTasks },
    { key: "skills", label: copy.skillsSquare, icon: RulerPen, active: activeWorkspacePane === "skills", badge: 0, onSelect: onOpenSkills },
    { key: "agents", label: copy.agentsNav, icon: Users2, active: activeWorkspacePane === "agents", badge: 0, onSelect: onOpenAgents },
    { key: "plans", label: copy.planBoardNav, icon: Bulb2, active: activeWorkspacePane === "plans", badge: 0, onSelect: onOpenPlans },
    { key: "miniapps", label: copy.miniAppsNav, icon: Widget2, active: activeWorkspacePane === "miniapps", badge: 0, onSelect: onOpenMiniApps }
  ]);

  const listProps = $derived({
    copy,
    channels,
    conversationsExpanded,
    projectsExpanded,
    roomsExpanded,
    expandedChannels,
    channelItems,
    channelHasMore,
    channelLoading,
    channelLoadingMore,
    activeSessionId,
    activeProjectSessionId,
    activeRoomId,
    rooms,
    roomMeta,
    roomsLabel,
    roomsCreateLabel,
    roomsEmptyLabel,
    endpoint,
    statusDots,
    formatTime,
    onOpenConversations,
    onOpenProjects,
    onOpenRooms,
    onToggleConversations,
    onToggleProjects,
    onToggleRooms,
    onToggleChannel,
    onSelectSession,
    onSelectRoom,
    onCreateRoom,
    onMoreChannel,
    onRenameSession,
    onDeleteSession,
    onCopySessionPath,
    onRevealSessionInFinder,
    onActivateProjectSession,
    onNewConversation,
    onOpenSettings
  });
</script>

<aside class="chat-sidebar" class:is-collapsed={collapsed} data-theme-region="sidebar">

  {#if collapsed}
    <div class="sidebar-collapsed">
      <nav class="sidebar-rail" aria-label={copy.chat}>
        <button
          type="button"
          class="rail-item"
          class:active={collapsedFlyout === "conversations"}
          aria-current={collapsedFlyout === "conversations" ? "page" : undefined}
          aria-label={copy.chat}
          title={copy.chat}
          onclick={() => onToggleFlyout?.("conversations")}
        >
          <ChatRoundLine size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="rail-item"
          class:active={collapsedFlyout === "projects"}
          aria-current={collapsedFlyout === "projects" ? "page" : undefined}
          aria-label={copy.projects}
          title={copy.projects}
          onclick={() => onToggleFlyout?.("projects")}
        >
          <Package size={18} weight="Filled" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="rail-item"
          class:active={collapsedFlyout === "rooms" || Boolean(activeRoomId)}
          aria-current={collapsedFlyout === "rooms" || activeRoomId ? "page" : undefined}
          aria-label={roomsLabel}
          title={roomsLabel}
          onclick={() => onToggleFlyout?.("rooms")}
        >
          <Dialog size={18} aria-hidden="true" />
        </button>
        {#each workspaceItems as item (item.key)}
          {@const Icon = item.icon}
          <button
            type="button"
            class="rail-item"
            class:active={item.active}
            aria-current={item.active ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            onclick={item.onSelect}
          >
            <Icon size={18} weight="Filled" aria-hidden="true" />
            {#if item.badge > 0}<span class="rail-notification" aria-label={`${item.badge} ${copy.tasksReminderUnread}`}>{item.badge > 99 ? "99+" : item.badge}</span>{/if}
          </button>
        {/each}
        <div class="rail-spacer"></div>
        <button
          type="button"
          class="rail-avatar"
          aria-label={`${copy.appName} · ${serviceState === "ready" ? copy.statusOnline : copy.statusOffline}`}
          title={copy.goToSettings}
          onclick={onOpenSettings}
        >
          <span class="sidebar-footer-logo-wrap" data-state={serviceState} aria-hidden="true">
            <img class="sidebar-footer-logo" src="/molibot-icon.png" alt="" width="20" height="20" />
          </span>
        </button>
      </nav>
      {#if collapsedFlyout}
        <div class="sidebar-flyout">
          <SidebarLists {...listProps} sections={[collapsedFlyout]} variant="flyout" />
        </div>
      {/if}
    </div>
  {:else}
    <nav class="sidebar-nav" aria-label={copy.newChat}>
      <button type="button" class="nav-item" onclick={onNewConversation}>
        <Pen size={16} aria-hidden="true" />
        <span>{copy.newChat}</span>
      </button>
      {#each workspaceItems as item (item.key)}
        {@const Icon = item.icon}
        <button type="button" class="nav-item" class:active={item.active} aria-current={item.active ? "page" : undefined} onclick={item.onSelect}>
          <Icon size={16} weight="Filled" aria-hidden="true" />
          <span>{item.label}</span>
          {#if item.badge > 0}<span class="nav-notification" aria-label={`${item.badge} ${copy.tasksReminderUnread}`}>{item.badge > 99 ? "99+" : item.badge}</span>{/if}
        </button>
      {/each}
    </nav>

    <SidebarLists {...listProps} sections={["conversations", "projects", "rooms"]} variant="sidebar" />

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
      <Settings2 class="sidebar-footer-gear" size={16} weight="Filled" aria-hidden="true" />
    </button>
  {/if}
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

  /* Collapsed presentation: a slim icon rail plus an on-demand list flyout. */
  .sidebar-collapsed {
    display: flex;
    flex-direction: row;
    flex: 1 1 auto;
    min-height: 0;
  }
  .sidebar-rail {
    display: flex;
    flex: 0 0 var(--sidebar-rail-w, 48px);
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: var(--sidebar-rail-w, 48px);
    padding: 0 4px;
  }
  .rail-item {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: var(--rounded-sm, 6px);
    background: transparent;
    color: var(--label-secondary, #666);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-standard), color var(--duration-instant) var(--ease-standard);
  }
  .rail-item:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); color: var(--label-primary, #171717); }
  .rail-item.active { background: var(--fill, rgba(0, 0, 0, 0.05)); color: var(--label-primary, #171717); }
  .rail-item.active :global(svg) { color: var(--accent, #006bff); }
  .rail-notification { position: absolute; top: 2px; right: 2px; display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: var(--radius-full, 999px); background: var(--accent, #006bff); color: var(--on-accent); font-size: var(--fs-meta); font-weight: 600; font-variant-numeric: tabular-nums; }
  .rail-spacer { flex: 1 1 auto; }
  .rail-avatar {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-bottom: 4px;
    padding: 0;
    border: 0;
    border-radius: var(--rounded-sm, 6px);
    background: transparent;
    cursor: pointer;
  }
  .rail-avatar:hover { background: var(--fill, rgba(0, 0, 0, 0.05)); }
  .sidebar-flyout {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding-left: 12px;
    border-left: 1px solid var(--separator);
  }

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
