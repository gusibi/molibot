<script lang="ts">
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { Translation } from "../i18n";
  import ConversationRow from "../chat/ConversationRow.svelte";
  import GroupHeader from "../chat/GroupHeader.svelte";
  import SidebarShell from "../chat/SidebarShell.svelte";
  import {
    addProject,
    newProjectSession,
    projectsStore,
    removeProjectSession,
    renameProjectSession,
    selectProject,
    selectProjectSession
  } from "../stores/projects.svelte";

  export let copy: Translation;
  export let openChat: () => void;
  export let openSettings: () => void;

  let adding = false;
  let createStep: "name" | "location" = "name";
  let name = "";
  let nameInput: HTMLInputElement;

  let rowLabels: {
    running: string;
    waitingApproval: string;
    completed: string;
    failed: string;
    menu: string;
    rename: string;
    delete: string;
    placeholder: string;
    deletePrompt: string;
    cancel: string;
  };
  $: rowLabels = {
    running: copy.running,
    waitingApproval: copy.waitingApproval,
    completed: copy.completed,
    failed: copy.failed,
    menu: copy.conversationMenu,
    rename: copy.renameConversation,
    delete: copy.deleteConversation,
    placeholder: copy.renamePlaceholder,
    deletePrompt: copy.deleteConversationPrompt,
    cancel: copy.cancelAction
  };
  function formatSessionTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (date.getTime() >= startOfToday) {
      return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
    }
    return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(date);
  }

  async function beginAdding(): Promise<void> {
    adding = true;
    createStep = "name";
    name = "";
    projectsStore.error = "";
    await tick();
    nameInput?.focus();
  }

  function cancelAdding(): void {
    if (projectsStore.busy === "add") return;
    adding = false;
    createStep = "name";
    name = "";
  }

  function continueToLocation(): void {
    if (!name.trim()) return;
    createStep = "location";
  }

  async function createManagedProject(): Promise<void> {
    if (await addProject({ name: name.trim(), createDirectory: true })) cancelAdding();
  }

  async function useExistingProjectFolder(): Promise<void> {
    if (projectsStore.busy === "add") return;
    projectsStore.error = "";
    try {
      const rootPath = await invoke<string | null>("pick_project_directory");
      if (!rootPath) return;
      if (await addProject({ name: name.trim(), rootPath })) cancelAdding();
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<SidebarShell>
  <nav class="sidebar-nav" aria-label={copy.projects}>
    <button type="button" class="nav-item" class:active={adding} onclick={() => void beginAdding()}>
      <i class="ph-fill ph-folder-plus" aria-hidden="true"></i>
      <span>{copy.addProject}</span>
    </button>
  </nav>

  <div class="conversation-list">
    {#each projectsStore.projects as project (project.id)}
      {@const isActiveProject = project.id === projectsStore.selectedProjectId}
      <div class="conv-group">
        <GroupHeader
          label={project.name}
          icon="ph-fill ph-notebook"
          open={isActiveProject}
          actionLabel={copy.newChat}
          onAction={() => void newProjectSession()}
          onToggle={() => void selectProject(project.id)}
        />

        {#if isActiveProject}
          {#each projectsStore.sessions as session (session.conversationId)}
            <ConversationRow
              item={{
                title: session.title,
                updatedAt: session.updatedAt,
                readOnly: false,
                botId: project.id,
                botName: project.name,
                botDeleted: false
              }}
              active={session.conversationId === projectsStore.selectedSessionId}
              formatTime={formatSessionTime}
              labels={rowLabels}
              onSelect={() => void selectProjectSession(session.conversationId, project.id)}
              onRename={(title) => void renameProjectSession(session.conversationId, title)}
              onDelete={() => void removeProjectSession(session.conversationId)}
            />
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  <div class="sidebar-bottom-actions">
    <button class="sidebar-return" type="button" onclick={openChat}>
      <i class="ph ph-arrow-left" aria-hidden="true"></i>
      <span>{copy.chat}</span>
    </button>
    <button class="sidebar-footer" type="button" onclick={openSettings}>
      <img class="sidebar-avatar" src="/molibot-icon.png" alt="" aria-hidden="true" />
      <span class="sidebar-footer-info">Molibot</span>
      <i class="ph ph-gear" aria-hidden="true"></i>
    </button>
  </div>
</SidebarShell>

{#if adding}
  <div class="project-dialog-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && cancelAdding()}>
    <div class="project-dialog project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
      <div class="project-dialog-heading">
        <span class="project-dialog-icon" aria-hidden="true"><i class="ph-fill ph-folder-plus"></i></span>
        <div>
          <h2 id="project-create-title">{copy.projectCreateTitle}</h2>
          <p>{createStep === "name" ? copy.projectCreateNameHint : copy.projectChooseLocationHint}</p>
        </div>
      </div>

      {#if createStep === "name"}
        <form onsubmit={(event) => { event.preventDefault(); continueToLocation(); }}>
          <label class="project-name-field">
            <span>{copy.projectName}</span>
            <input bind:this={nameInput} bind:value={name} autocomplete="off" required placeholder={copy.projectNamePlaceholder} />
          </label>
          <div class="project-form-actions">
            <button class="secondary-button" type="button" onclick={cancelAdding}>{copy.cancel}</button>
            <button class="primary-button" disabled={!name.trim()}>{copy.continueAction}</button>
          </div>
        </form>
      {:else}
        <div class="project-location-options" aria-label={copy.projectChooseLocation}>
          <button type="button" class="project-location-option" disabled={projectsStore.busy === "add"} onclick={() => void createManagedProject()}>
            <span class="project-location-icon"><i class="ph-fill ph-folder-simple-plus" aria-hidden="true"></i></span>
            <span><strong>{copy.projectCreateFolder}</strong><small>{copy.projectCreateFolderHint}</small></span>
            <i class="ph ph-arrow-right" aria-hidden="true"></i>
          </button>
          <button type="button" class="project-location-option" disabled={projectsStore.busy === "add"} onclick={() => void useExistingProjectFolder()}>
            <span class="project-location-icon"><i class="ph-fill ph-folder-open" aria-hidden="true"></i></span>
            <span><strong>{copy.projectUseExistingFolder}</strong><small>{copy.projectUseExistingFolderHint}</small></span>
            <i class="ph ph-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
        <div class="project-form-actions project-location-actions">
          <button class="secondary-button" type="button" disabled={projectsStore.busy === "add"} onclick={() => (createStep = "name")}>{copy.back}</button>
          <button class="secondary-button" type="button" disabled={projectsStore.busy === "add"} onclick={cancelAdding}>{copy.cancel}</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
