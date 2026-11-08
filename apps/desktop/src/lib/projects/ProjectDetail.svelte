<script lang="ts">
  import MessageSearch from "reicon-svelte/icons/MessageSearch";
  import Sidebar from "../icons/duotone/components/Sidebar.svelte";
  import Settings2 from "reicon-svelte/icons/Settings2";
  import DuotoneIcon from "../icons/duotone/DuotoneIcon.svelte";
  import { onDestroy, tick } from "svelte";
  import type { Translation } from "../i18n";
  import { newProjectSession, projectsStore } from "../stores/projects.svelte";
  import ChatHeader from "../chat/ChatHeader.svelte";
  import TranscriptSearch from "../chat/TranscriptSearch.svelte";
  import {
    clampTranscriptSearchIndex,
    findTranscriptMatches,
    type TranscriptMessage
  } from "../chat/transcript";
  import ProjectChat from "./ProjectChat.svelte";
  import { projectChatStore } from "./projectChatStore.svelte";
  import ProjectSettingsDialog from "./ProjectSettingsDialog.svelte";
  import MiniAppsQuickMenu from "../miniapps/MiniAppsQuickMenu.svelte";
  import { loadDesktopModels } from "../api";
  import type { DesktopModelOption } from "@molibot/desktop-contract";
  import { SETTINGS_CHANGED_EVENT, session as sessionStore } from "../stores/session.svelte";
  import ContextWindowPanel from "../chat/ContextWindowPanel.svelte";
  import type { UiMessage } from "../chat/conversationController.svelte";
  import type { DesktopConversationActivity, DesktopSessionUsageSummary } from "@molibot/desktop-contract";
  import type { ComposerContextUsage } from "../presentation";
  // Runes mode (not legacy `$:`) so these derivations track the `projectsStore`
  // rune `$state`. A legacy `$:` only runs once at init and would leave `project`
  // undefined on first open (when projects are still loading), hiding the whole
  // right pane until a remount — the Project transcript "first-click does nothing"
  // bug. Template reads elsewhere (e.g. ProjectList's `{#each}`) stay reactive.
  let {
    copy,
    autoAvailable = false,
    onOpenFiles = () => {},
    onOpenMiniApp = () => {},
    onOpenMiniApps = () => {}
  }: {
    copy: Translation;
    autoAvailable?: boolean;
    onOpenFiles?: () => void;
    onOpenMiniApp?: (appId: string) => void;
    onOpenMiniApps?: () => void;
  } = $props();
  const project = $derived(projectsStore.projects.find((item) => item.id === projectsStore.selectedProjectId));
  const session = $derived(projectsStore.sessions.find((item) => item.conversationId === projectsStore.selectedSessionId));
  const headerTitle = $derived(session?.title || copy.newChat);
  let settingsOpen = $state(false);
  let modelOptions = $state<DesktopModelOption[]>([]);
  let contentElement = $state<HTMLElement>();
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let searchIndex = $state(0);
  let previousSearchMatchCount = $state(0);
  let searchReturnFocus = $state<HTMLElement | null>(null);
  let transcriptMessages = $state<TranscriptMessage[]>([]);
  type ProjectContextRuntime = {
    contextUsage: ComposerContextUsage | null;
    sessionUsage: DesktopSessionUsageSummary | null;
    fallbackContextWindow: number;
    modelLabel: string;
    sending: boolean;
    streamingText: string;
    streamingThinking: string;
    activities: DesktopConversationActivity[];
    messages: UiMessage[];
  };
  let contextRuntime = $state<ProjectContextRuntime>({
    contextUsage: null,
    sessionUsage: null,
    fallbackContextWindow: 0,
    modelLabel: "",
    sending: false,
    streamingText: "",
    streamingThinking: "",
    activities: [],
    messages: []
  });
  const unsubscribeProjectChat = projectChatStore.state.subscribe((state) => {
    transcriptMessages = state.messages;
  });
  onDestroy(unsubscribeProjectChat);
  const searchMatchIds = $derived(findTranscriptMatches(transcriptMessages, searchOpen ? searchQuery : "", copy.chatAssistantError));
  const boundedSearchIndex = $derived(clampTranscriptSearchIndex(searchIndex, searchMatchIds.length));
  const activeMatchId = $derived(searchMatchIds[boundedSearchIndex] ?? "");
  $effect(() => {
    const matchCount = searchMatchIds.length;
    if (matchCount === previousSearchMatchCount) return;
    previousSearchMatchCount = matchCount;
    searchIndex = clampTranscriptSearchIndex(searchIndex, matchCount);
  });

  async function toggleSearch(): Promise<void> {
    if (searchOpen) {
      searchOpen = false;
      searchQuery = "";
      searchIndex = 0;
      await tick();
      searchReturnFocus?.focus();
      searchReturnFocus = null;
      return;
    }
    searchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchOpen = true;
  }

  function onSearchInput(): void {
    searchIndex = 0;
    void scrollToMatch();
  }

  function gotoMatch(delta: number): void {
    if (searchMatchIds.length === 0) return;
    searchIndex = (boundedSearchIndex + delta + searchMatchIds.length) % searchMatchIds.length;
    void scrollToMatch();
  }

  async function scrollToMatch(): Promise<void> {
    await tick();
    if (!activeMatchId) return;
    contentElement?.querySelector(`[data-message-id="${CSS.escape(activeMatchId)}"]`)?.scrollIntoView({ block: "center", behavior: "auto" });
  }
  function refreshModels(): void {
    if (!projectsStore.endpoint) return;
    void loadDesktopModels(projectsStore.endpoint).then((state) => { modelOptions = state.options; }).catch(() => { modelOptions = []; });
  }
  function updateContextRuntime(next: typeof contextRuntime): void {
    contextRuntime = next;
  }
  $effect(() => {
    if (!projectsStore.endpoint) return;
    refreshModels();
  });
  if (typeof window !== "undefined") {
    window.addEventListener(SETTINGS_CHANGED_EVENT, refreshModels);
  }
  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, refreshModels);
    }
  });
</script>

{#if project}
  <!-- Same transcript canvas as the chat dimension, so it carries the same
       region hook: the project pane was the one surface where a family's canvas
       treatment never reached. -->
  <section class="chat-content" data-theme-region="chat" bind:this={contentElement}>
    <ChatHeader
      title={headerTitle}
      sourceLabel={project.name}
      searching={searchOpen}
    >
      {#snippet actions()}
        {#if projectsStore.selectedSessionId && projectsStore.endpoint}
          <ContextWindowPanel
            {copy}
            locale={sessionStore.locale}
            endpoint={projectsStore.endpoint}
            profileId="personal"
            sessionId={projectsStore.selectedSessionId}
            projectId={projectsStore.selectedProjectId}
            usage={contextRuntime.contextUsage}
            sessionUsage={contextRuntime.sessionUsage}
            fallbackContextWindow={contextRuntime.fallbackContextWindow}
            modelLabel={contextRuntime.modelLabel}
            sending={contextRuntime.sending}
            streamingText={contextRuntime.streamingText}
            streamingThinking={contextRuntime.streamingThinking}
            activities={contextRuntime.activities}
            messages={contextRuntime.messages}
          />
        {/if}
        <TranscriptSearch
          bind:value={searchQuery}
          open={searchOpen}
          matchCount={searchMatchIds.length}
          activeIndex={boundedSearchIndex}
          placeholder={copy.searchPlaceholder}
          noMatchesLabel={copy.noMatches}
          previousLabel={copy.prevMatch}
          nextLabel={copy.nextMatch}
          closeLabel={copy.closeSearch}
          onInput={onSearchInput}
          onPrevious={() => gotoMatch(-1)}
          onNext={() => gotoMatch(1)}
          onClose={toggleSearch}
        />
        {#if !searchOpen}
          <button class="icon-button" type="button" aria-label={copy.search} title={copy.search} onclick={toggleSearch}>
            <MessageSearch size={16} aria-hidden="true" />
          </button>
        {/if}
        <MiniAppsQuickMenu
          {copy}
          endpoint={projectsStore.endpoint}
          onOpenApp={onOpenMiniApp}
          onOpenLaunchpad={onOpenMiniApps}
        />
        <button class="icon-button" type="button" aria-label={copy.files} title={copy.files} onclick={onOpenFiles}>
          <Sidebar class="flip" size={16} aria-hidden="true" />
        </button>
        <button class="icon-button" type="button" aria-label={copy.projectSettings} title={copy.projectSettings} onclick={() => (settingsOpen = true)}><Settings2 size={16} weight="Filled" aria-hidden="true" /></button>
      {/snippet}
    </ChatHeader>
    <div class="project-body">{#if projectsStore.selectedSessionId}<ProjectChat {copy} {searchMatchIds} {activeMatchId} onContextRuntimeChange={updateContextRuntime} />{:else}<div class="project-empty"><strong>{copy.projectNoSessions}</strong><button class="primary-button" type="button" onclick={() => void newProjectSession()}>{copy.newChat}</button></div>{/if}</div>
  </section>
  {#if settingsOpen}<ProjectSettingsDialog {project} {copy} {modelOptions} {autoAvailable} onClose={() => (settingsOpen = false)} />{/if}
{:else}
  <section class="project-welcome"><DuotoneIcon name="Folder" size={28} aria-hidden="true" /><h1>{copy.projectWelcome}</h1><p>{copy.projectWelcomeHint}</p></section>
{/if}
