<script lang="ts">
  import type { Translation } from "../i18n";
  import { newProjectSession, projectsStore } from "../stores/projects.svelte";
  import ChatHeader from "../chat/ChatHeader.svelte";
  import ProjectChat from "./ProjectChat.svelte";
  // Runes mode (not legacy `$:`) so these derivations track the `projectsStore`
  // rune `$state`. A legacy `$:` only runs once at init and would leave `project`
  // undefined on first open (when projects are still loading), hiding the whole
  // right pane until a remount — the Project transcript "first-click does nothing"
  // bug. Template reads elsewhere (e.g. ProjectList's `{#each}`) stay reactive.
  let {
    copy,
    onSearch = () => {},
    onOpenFiles = () => {}
  }: {
    copy: Translation;
    onSearch?: () => void;
    onOpenFiles?: () => void;
  } = $props();
  const project = $derived(projectsStore.projects.find((item) => item.id === projectsStore.selectedProjectId));
  const projectInitial = $derived((project?.name.trim().charAt(0) || "M").toUpperCase());
  const session = $derived(projectsStore.sessions.find((item) => item.conversationId === projectsStore.selectedSessionId));
  const headerTitle = $derived(project ? `${project.name} / ${session?.title || copy.newChat}` : copy.chat);
</script>

{#if project}
  <section class="chat-content">
    <ChatHeader avatar={projectInitial} showAvatar={false} title={headerTitle}>
      <svelte:fragment slot="actions">
        <button class="icon-button" type="button" aria-label={copy.search} title={copy.search} onclick={onSearch}>
          <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
        </button>
        <button class="icon-button" type="button" aria-label={copy.files} title={copy.files} onclick={onOpenFiles}>
          <i class="ph ph-sidebar-simple flip" aria-hidden="true"></i>
        </button>
      </svelte:fragment>
    </ChatHeader>
    <div class="project-body">{#if projectsStore.selectedSessionId}<ProjectChat {copy} />{:else}<div class="project-empty"><strong>{copy.projectNoSessions}</strong><button class="primary-button" type="button" onclick={() => void newProjectSession()}>{copy.newChat}</button></div>{/if}</div>
  </section>
{:else}
  <section class="project-welcome"><i class="ph ph-folders" aria-hidden="true"></i><h1>{copy.projectWelcome}</h1><p>{copy.projectWelcomeHint}</p></section>
{/if}
