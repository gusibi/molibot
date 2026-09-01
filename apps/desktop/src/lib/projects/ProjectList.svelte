<script lang="ts">
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import FolderOpen from "reicon-svelte/icons/FolderOpen";
  import FolderPlus from "reicon-svelte/icons/FolderPlus";
  import Gear from "reicon-svelte/icons/Gear";
  import { tick } from "svelte";
  import type { Translation } from "../i18n";
  import ConversationRow from "../chat/ConversationRow.svelte";
  import GroupHeader from "../chat/GroupHeader.svelte";
  import SidebarShell from "../chat/SidebarShell.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import {
    addProject,
    newProjectSession,
    pickProjectDirectory,
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
  let selectedRootPath = "";
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
    selectedRootPath = "";
    projectsStore.error = "";
    await tick();
    nameInput?.focus();
  }

  function cancelAdding(): void {
    if (projectsStore.busy === "add" || projectsStore.pickingFolder) return;
    adding = false;
    createStep = "name";
    name = "";
    selectedRootPath = "";
  }

  function continueToLocation(): void {
    if (!name.trim()) return;
    createStep = "location";
  }

  async function createManagedProject(): Promise<void> {
    if (await addProject({ name: name.trim(), createDirectory: true })) cancelAdding();
  }

  async function useExistingProjectFolder(): Promise<void> {
    const rootPath = await pickProjectDirectory();
    if (rootPath) selectedRootPath = rootPath;
  }
</script>

<SidebarShell>
  <nav class="sidebar-nav" aria-label={copy.projects}>
    <button type="button" class="nav-item" class:active={adding} onclick={() => void beginAdding()}>
      <FolderPlus weight="Filled" size={20} aria-hidden="true" />
      <span>{copy.addProject}</span>
    </button>
  </nav>

  <div class="conversation-list">
    {#each projectsStore.projects as project (project.id)}
      {@const isActiveProject = project.id === projectsStore.selectedProjectId}
      <div class="conv-group">
        <GroupHeader
          label={project.name}
          icon="notebook"
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
      <ArrowLeft size={16} aria-hidden="true" />
      <span>{copy.chat}</span>
    </button>
    <button class="sidebar-footer" type="button" onclick={openSettings}>
      <img class="sidebar-avatar" src="/molibot-icon.png" alt="" aria-hidden="true" width="20" height="20" />
      <span class="sidebar-footer-info">Molibot</span>
      <Gear size={16} aria-hidden="true" />
    </button>
  </div>
</SidebarShell>

{#if adding}
  <Dialog
    open={adding}
    busy={projectsStore.busy === "add"}
    contentClass="project-dialog project-create-dialog"
    labelledBy="project-create-title"
    onOpenChange={(next) => { if (!next) cancelAdding(); }}
  >
    <div class="project-dialog-heading">
      <span class="project-dialog-icon" aria-hidden="true"><FolderPlus weight="Filled" size={20} aria-hidden="true" /></span>
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
      <div class="project-location-options" aria-label={copy.projectChooseLocation} aria-busy={projectsStore.pickingFolder}>
        <button type="button" class="project-location-option" disabled={projectsStore.busy === "add" || projectsStore.pickingFolder} onclick={() => void createManagedProject()}>
          <span class="project-location-icon"><FolderPlus weight="Filled" size={20} aria-hidden="true" /></span>
          <span><strong>{copy.projectCreateFolder}</strong><small>{copy.projectCreateFolderHint}</small></span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button type="button" class="project-location-option" disabled={projectsStore.busy === "add" || projectsStore.pickingFolder} onclick={() => void useExistingProjectFolder()}>
          <span class="project-location-icon"><FolderOpen weight="Filled" size={20} aria-hidden="true" /></span>
          <span><strong>{copy.projectUseExistingFolder}</strong><small>{copy.projectUseExistingFolderHint}</small></span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
      {#if selectedRootPath}
        <div class="project-selected-location">
          <FolderOpen weight="Filled" size={20} aria-hidden="true" />
          <span><small>{copy.projectSelectedLocation}</small><strong>{selectedRootPath}</strong></span>
        </div>
      {/if}
      <div class="project-form-actions project-location-actions">
        <button class="secondary-button" type="button" disabled={projectsStore.busy === "add" || projectsStore.pickingFolder} onclick={() => (createStep = "name")}>{copy.back}</button>
        <button class="secondary-button" type="button" disabled={projectsStore.busy === "add" || projectsStore.pickingFolder} onclick={cancelAdding}>{copy.cancel}</button>
        <button class="primary-button" type="button" disabled={!selectedRootPath || projectsStore.busy === "add" || projectsStore.pickingFolder} onclick={() => void addProject({ name: name.trim(), rootPath: selectedRootPath }).then((created) => created && cancelAdding())}>{copy.projectCreateAction}</button>
      </div>
    {/if}
  </Dialog>
{/if}
