<script lang="ts">
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
  import { loadDesktopModels } from "../api";
  import type { DesktopModelOption } from "@molibot/desktop-contract";
  // Runes mode (not legacy `$:`) so these derivations track the `projectsStore`
  // rune `$state`. A legacy `$:` only runs once at init and would leave `project`
  // undefined on first open (when projects are still loading), hiding the whole
  // right pane until a remount — the Project transcript "first-click does nothing"
  // bug. Template reads elsewhere (e.g. ProjectList's `{#each}`) stay reactive.
  let {
    copy,
    onOpenFiles = () => {}
  }: {
    copy: Translation;
    onOpenFiles?: () => void;
  } = $props();
  const project = $derived(projectsStore.projects.find((item) => item.id === projectsStore.selectedProjectId));
  const projectInitial = $derived((project?.name.trim().charAt(0) || "M").toUpperCase());
  const session = $derived(projectsStore.sessions.find((item) => item.conversationId === projectsStore.selectedSessionId));
  const headerTitle = $derived(project ? `${project.name} / ${session?.title || copy.newChat}` : copy.chat);
  let settingsOpen = $state(false);
  let modelOptions = $state<DesktopModelOption[]>([]);
  let contentElement = $state<HTMLElement>();
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let searchIndex = $state(0);
  let previousSearchMatchCount = $state(0);
  let searchReturnFocus = $state<HTMLElement | null>(null);
  let transcriptMessages = $state<TranscriptMessage[]>([]);
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
  $effect(() => {
    if (!projectsStore.endpoint) return;
    void loadDesktopModels(projectsStore.endpoint).then((state) => { modelOptions = state.options; }).catch(() => { modelOptions = []; });
  });
</script>

{#if project}
  <section class="chat-content" bind:this={contentElement}>
    <ChatHeader avatar={projectInitial} showAvatar={false} title={headerTitle} searching={searchOpen}>
      <svelte:fragment slot="actions">
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
            <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          </button>
        {/if}
        <button class="icon-button" type="button" aria-label={copy.files} title={copy.files} onclick={onOpenFiles}>
          <i class="ph ph-sidebar-simple flip" aria-hidden="true"></i>
        </button>
        <button class="icon-button" type="button" aria-label={copy.projectSettings} title={copy.projectSettings} onclick={() => (settingsOpen = true)}><i class="ph ph-gear-six" aria-hidden="true"></i></button>
      </svelte:fragment>
    </ChatHeader>
    <div class="project-body">{#if projectsStore.selectedSessionId}<ProjectChat {copy} {searchMatchIds} {activeMatchId} />{:else}<div class="project-empty"><strong>{copy.projectNoSessions}</strong><button class="primary-button" type="button" onclick={() => void newProjectSession()}>{copy.newChat}</button></div>{/if}</div>
  </section>
  {#if settingsOpen}<ProjectSettingsDialog {project} {copy} {modelOptions} onClose={() => (settingsOpen = false)} />{/if}
{:else}
  <section class="project-welcome"><i class="ph ph-folders" aria-hidden="true"></i><h1>{copy.projectWelcome}</h1><p>{copy.projectWelcomeHint}</p></section>
{/if}
