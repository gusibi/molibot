<script lang="ts">
  import RowContextMenu from "../components/ui/RowContextMenu.svelte";
  import type { Snippet } from "svelte";
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import Plus from "reicon-svelte/icons/Plus";
  import Users2 from "../icons/duotone/components/Users2.svelte";
  import Dialog from "../icons/duotone/components/Dialog.svelte";
  import ChannelAccordion, { type ChannelDescriptor } from "./ChannelAccordion.svelte";
  import GroupHeader from "./GroupHeader.svelte";
  import type { DesktopConversationItem } from "@molibot/desktop-contract";
  import type { AgentRoom } from "@molibot/shared/rooms";
  import type { SessionStatusDot } from "./sessionStatusDot.js";
  import ProjectTree from "../projects/ProjectTree.svelte";
  import type { Translation } from "../i18n";

  export type SidebarListSection = "conversations" | "projects" | "rooms";

  let {
    copy,
    conversationContent,
    channels,
    sections,
    conversationsExpanded,
    projectsExpanded,
    roomsExpanded,
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
    roomsLabel,
    roomsCreateLabel,
    roomsEditLabel,
    roomsDeleteLabel,
    roomsEmptyLabel,
    endpoint,
    statusDots = new Map<string, SessionStatusDot>(),
    formatTime,
    variant = "sidebar",
    onOpenConversations,
    onOpenProjects,
    onOpenRooms,
    onToggleConversations,
    onToggleProjects,
    onToggleRooms,
    onToggleChannel,
    onSelectSession,
    onSelectRoom,
    onEditRoom,
    onDeleteRoom,
    onCreateRoom,
    onMoreChannel,
    onRenameSession,
    onDeleteSession,
    onCopySessionPath,
    onRevealSessionInFinder,
    onActivateProjectSession,
    onNewConversation,
    onOpenSettings
  }: {
    copy: Translation;
    conversationContent: Snippet;
    channels: ChannelDescriptor[];
    sections: SidebarListSection[];
    conversationsExpanded: boolean;
    projectsExpanded: boolean;
    roomsExpanded: boolean;
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
    roomsLabel: string;
    roomsCreateLabel: string;
    roomsEditLabel: string;
    roomsDeleteLabel: string;
    roomsEmptyLabel: string;
    endpoint: string;
    statusDots?: Map<string, SessionStatusDot>;
    formatTime: (iso: string) => string;
    variant?: "sidebar" | "flyout";
    onOpenConversations: () => void;
    onOpenProjects: () => void;
    onOpenRooms: () => void;
    onToggleConversations: () => void;
    onToggleProjects: () => void;
    onToggleRooms: () => void;
    onToggleChannel: (channel: string) => void;
    onSelectSession: (item: DesktopConversationItem) => void;
    onSelectRoom: (roomId: string) => void;
    onEditRoom: (roomId: string) => void;
    onDeleteRoom: (roomId: string) => void;
    onCreateRoom: () => void;
    onMoreChannel: (channel: string) => void;
    onRenameSession: (item: DesktopConversationItem, title: string) => void;
    onDeleteSession: (item: DesktopConversationItem) => void;
    onCopySessionPath?: (item: DesktopConversationItem) => void | Promise<void>;
    onRevealSessionInFinder?: (item: DesktopConversationItem) => void | Promise<void>;
    onActivateProjectSession: () => void;
    onNewConversation: () => void;
    onOpenSettings: () => void;
  } = $props();

  // In the collapsed flyout the selected section is shown as the flyout content,
  // so it is always open regardless of the persisted collapse preference.
  const conversationsOpen = $derived(variant === "flyout" || conversationsExpanded);
  const projectsOpen = $derived(variant === "flyout" || projectsExpanded);
  const roomsOpen = $derived(variant === "flyout" || roomsExpanded);

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
    taskTag: copy.sessionTaskTag,
    newChat: copy.newChat,
    loading: copy.loading
  });
</script>

<div class="sidebar-channels" class:sidebar-channels-flyout={variant === "flyout"} data-theme-region="session-list">
  {#if variant === "sidebar"}
    <h2 class="sidebar-group-label">{copy.sidebarCollaboration}</h2>
  {/if}
  {#if sections.includes("conversations")}
    <section class="sidebar-tree-section">
      <div class="sidebar-section-head">
        <button type="button" class="sidebar-section-toggle" aria-expanded={conversationsOpen} onclick={onToggleConversations}>
          <Users2 size={16} aria-hidden="true" />
          <span>{copy.agentsNav}</span>
        </button>
        <button type="button" class="sidebar-section-caret-btn" aria-expanded={conversationsOpen} aria-label={copy.agentsNav} onclick={onToggleConversations}>
          <i aria-hidden="true"><CaretRight class={conversationsOpen ? "sidebar-section-caret open" : "sidebar-section-caret"} size={12} /></i>
        </button>
      </div>
      {#if conversationsOpen}
        <div class="sidebar-tree-children">{@render conversationContent()}</div>
      {/if}
    </section>
  {/if}
  {#if sections.includes("rooms")}
    <section class="sidebar-tree-section">
      <div class="sidebar-section-head" class:open={roomsExpanded}>
        <button type="button" class="sidebar-section-toggle" aria-expanded={roomsOpen} onclick={onToggleRooms}>
          <Dialog size={16} aria-hidden="true" />
          <span>{roomsLabel}</span>
        </button>
        <button type="button" class="sidebar-section-caret-btn" aria-expanded={roomsOpen} aria-label={roomsLabel} onclick={onToggleRooms}>
          <i aria-hidden="true"><CaretRight class={roomsOpen ? "sidebar-section-caret open" : "sidebar-section-caret"} size={12} /></i>
        </button>
        <button type="button" class="sidebar-section-caret-btn sidebar-section-action" aria-label={roomsCreateLabel} title={roomsCreateLabel} onclick={onCreateRoom}><Plus size={16} aria-hidden="true" /></button>
      </div>
      {#if roomsOpen}
        <div class="sidebar-tree-children rooms-tree">
          {#if rooms.length === 0}
            <p class="rooms-empty">{roomsEmptyLabel}</p>
          {:else}
            {#each rooms as room (room.id)}
              <RowContextMenu items={[{label: roomsEditLabel, onSelect: () => onEditRoom(room.id)}, {label: roomsDeleteLabel, danger: true, onSelect: () => onDeleteRoom(room.id)}]}>
                <GroupHeader
                  label={room.title}
                  active={room.id === activeRoomId}
                  open={false}
                  expandable={false}
                  onToggle={() => onSelectRoom(room.id)}
                >
                  {#snippet avatar()}<Dialog size={16} aria-hidden="true" />{/snippet}
                  {#snippet status()}<span class="sidebar-room-meta">{roomMeta(room)}</span>{/snippet}
                </GroupHeader>
              </RowContextMenu>
            {/each}
          {/if}
        </div>
      {/if}
    </section>
  {/if}
  {#if sections.includes("projects")}
    <section class="sidebar-tree-section">
      <ProjectTree {copy} {endpoint} expanded={projectsOpen} activeSessionId={activeProjectSessionId} {formatTime} onOpen={onToggleProjects} onToggle={onToggleProjects} onActivateSession={onActivateProjectSession} />
    </section>
  {/if}
</div>

<style>
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
  /* In the collapsed flyout the rail already owns the left edge and the flyout
     owns the divider, so the bleed-to-divider trick does not apply. */
  .sidebar-channels-flyout { margin-right: 0; }
  .sidebar-group-label {
    margin: 8px 12px;
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    font-weight: 600;
    letter-spacing: var(--tracking-caps);
  }
  .sidebar-tree-section { min-width: 0; padding: 0 0 4px; }
  .sidebar-room-meta { flex: 0 0 auto; color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rooms-tree :global(.conv-group-head.active) { background: var(--fill); }
  .rooms-empty { margin: 0; padding: 6px 8px 6px 32px; color: var(--label-tertiary); font-size: var(--fs-label); line-height: var(--lh-label); }
</style>
