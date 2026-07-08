<script lang="ts">
  import type { Translation } from "../i18n";
  import { newProjectSession, projectsStore, removeProject } from "../stores/projects.svelte";
  import ProjectChat from "./ProjectChat.svelte";
  // Runes mode (not legacy `$:`) so these derivations track the `projectsStore`
  // rune `$state`. A legacy `$:` only runs once at init and would leave `project`
  // undefined on first open (when projects are still loading), hiding the whole
  // right pane until a remount — the Project transcript "first-click does nothing"
  // bug. Template reads elsewhere (e.g. ProjectList's `{#each}`) stay reactive.
  let { copy }: { copy: Translation } = $props();
  let confirmDelete = $state(false);
  let removeSessions = $state(false);
  const project = $derived(projectsStore.projects.find((item) => item.id === projectsStore.selectedProjectId));
  const projectInitial = $derived((project?.name.trim().charAt(0) || "M").toUpperCase());
</script>

{#if project}
  <section class="chat-content">
    <header class="chat-header" data-tauri-drag-region>
      <div class="chat-title-block" data-tauri-drag-region>
        <div class="chat-header-avatar" aria-hidden="true">{projectInitial}</div>
        <div class="chat-title-text" data-tauri-drag-region>
          <div class="chat-title-name">{project.name}</div>
          <div class="chat-title-sub" title={project.rootPath}>{project.rootPath}</div>
        </div>
      </div>
      <div class="header-actions">
        <button class="secondary-button" type="button" onclick={() => (confirmDelete = true)}>{copy.delete}</button>
        <button class="secondary-button" type="button" onclick={() => void newProjectSession()}><i class="ph ph-plus" aria-hidden="true"></i>{copy.newChat}</button>
      </div>
    </header>
    <div class="project-body">{#if projectsStore.selectedSessionId}<ProjectChat {copy} />{:else}<div class="project-empty"><strong>{copy.projectNoSessions}</strong><button class="primary-button" type="button" onclick={() => void newProjectSession()}>{copy.newChat}</button></div>{/if}</div>
  </section>
  {#if confirmDelete}
    <div class="project-dialog-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (confirmDelete = false)}>
      <div class="project-dialog" role="alertdialog" aria-modal="true" aria-labelledby="project-delete-title"><h2 id="project-delete-title">{copy.projectDeleteTitle}</h2><p>{copy.projectDeleteNotice}</p><label class="project-delete-option"><input type="checkbox" bind:checked={removeSessions} /><span>{copy.projectDeleteSessions}</span></label><div class="project-form-actions"><button class="secondary-button" type="button" onclick={() => (confirmDelete = false)}>{copy.cancel}</button><button class="secondary-button danger-action" type="button" onclick={() => { confirmDelete = false; void removeProject(removeSessions); }}>{copy.delete}</button></div></div>
    </div>
  {/if}
{:else}
  <section class="project-welcome"><i class="ph ph-folders" aria-hidden="true"></i><h1>{copy.projectWelcome}</h1><p>{copy.projectWelcomeHint}</p></section>
{/if}
