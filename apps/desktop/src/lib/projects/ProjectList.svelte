<script lang="ts">
  import type { Translation } from "../i18n";
  import { invoke } from "@tauri-apps/api/core";
  import {
    addProject,
    newProjectSession,
    projectsStore,
    removeProjectSession,
    renameProjectSession,
    selectProject,
    selectProjectSession
  } from "../stores/projects.svelte";
  import { projectNameFromPath } from "./projectPicker";
  import type { DesktopProjectSession } from "../api";
  export let copy: Translation;
  export let openChat: () => void;
  let adding = false;
  let name = "";
  let rootPath = "";
  let editingSessionId = "";
  let editingSessionTitle = "";
  let deleteConfirmId = "";
  let deleteAnchor = { top: 0, left: 0, width: 0 };

  async function chooseProjectDirectory(): Promise<boolean> {
    projectsStore.error = "";
    try {
      const selected = await invoke<string | null>("pick_project_directory");
      if (!selected) return false;
      rootPath = selected;
      if (!name.trim()) name = projectNameFromPath(selected);
      return true;
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }

  async function beginAdding(): Promise<void> {
    if (adding) { adding = false; return; }
    if (await chooseProjectDirectory()) adding = true;
  }

  async function submit(): Promise<void> {
    if (await addProject({ name, rootPath })) { name = ""; rootPath = ""; adding = false; }
  }

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

  function beginRename(session: DesktopProjectSession): void {
    if (projectsStore.busy === "session") return;
    editingSessionId = session.conversationId;
    editingSessionTitle = session.title;
    deleteConfirmId = "";
  }

  function cancelRename(): void {
    editingSessionId = "";
    editingSessionTitle = "";
  }

  function commitRename(session: DesktopProjectSession): void {
    const title = editingSessionTitle.trim();
    if (title && title !== session.title) {
      void renameProjectSession(session.conversationId, title);
    }
    cancelRename();
  }

  function requestDelete(session: DesktopProjectSession, event: MouseEvent): void {
    deleteConfirmId = session.conversationId;
    editingSessionId = "";
    const row = (event.currentTarget as HTMLElement).closest(".conversation-row") as HTMLElement | null;
    if (row) {
      const rect = row.getBoundingClientRect();
      deleteAnchor = { top: rect.top, left: rect.left, width: rect.width };
    }
  }

  function cancelDelete(): void {
    deleteConfirmId = "";
  }

  function confirmDelete(session: DesktopProjectSession): void {
    deleteConfirmId = "";
    void removeProjectSession(session.conversationId);
  }

  function onRenameKeydown(event: KeyboardEvent, session: DesktopProjectSession): void {
    if (event.key === "Enter") { event.preventDefault(); commitRename(session); }
    else if (event.key === "Escape") { event.preventDefault(); cancelRename(); }
  }
</script>

<aside class="chat-sidebar">
  <div class="brand-row">
    <div class="brand-mark" aria-hidden="true">M</div>
    <div class="brand-copy"><strong>{copy.projects}</strong></div>
  </div>

  <div class="nav-list">
    <button class="nav-item" type="button" onclick={openChat}>
      <i class="ph ph-arrow-left" aria-hidden="true"></i>
      <span>{copy.chat}</span>
    </button>
    <button class="nav-item" class:active={adding} type="button" onclick={() => void beginAdding()}>
      <i class="ph ph-folder-plus" aria-hidden="true"></i>
      <span>{copy.addProject}</span>
    </button>
  </div>

  {#if adding}
    <form class="project-add-form" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>{copy.projectName}<input bind:value={name} required /></label>
      <label>{copy.projectPath}<span class="project-selected-directory"><i class="ph ph-folder-open" aria-hidden="true"></i><span title={rootPath}>{rootPath}</span><button class="secondary-button" type="button" onclick={() => void chooseProjectDirectory()}>{copy.changeProjectFolder}</button></span></label>
      <div class="project-form-actions"><button class="secondary-button" type="button" onclick={() => (adding = false)}>{copy.cancel}</button><button class="primary-button" disabled={projectsStore.busy === "add"}>{copy.add}</button></div>
    </form>
  {/if}

  <div class="conversation-list">
    {#each projectsStore.projects as project (project.id)}
      {@const isActiveProject = project.id === projectsStore.selectedProjectId}
      <div class="conv-group">
        <button class="conv-group-head" class:open={isActiveProject} type="button" aria-expanded={isActiveProject} onclick={() => void selectProject(project.id)}>
          <span class="conv-group-tile" style="background: var(--accent)" aria-hidden="true"><i class="ph-fill ph-notebook"></i></span>
          <span class="conv-group-label">{project.name}</span>
          <i class="ph-bold ph-caret-down conv-caret" class:open={isActiveProject} aria-hidden="true"></i>
        </button>

        {#if isActiveProject}
          {#each projectsStore.sessions as item (item.conversationId)}
            <div class="conversation-row" class:active={item.conversationId === projectsStore.selectedSessionId} data-session-id={item.conversationId}>
              {#if editingSessionId === item.conversationId}
                <div class="conversation-editor">
                  <input bind:value={editingSessionTitle} aria-label={copy.rename} onkeydown={(event) => onRenameKeydown(event, item)} />
                  <div>
                    <button type="button" onclick={() => commitRename(item)}>{copy.save}</button>
                    <button type="button" onclick={cancelRename}>{copy.cancel}</button>
                  </div>
                </div>
              {:else}
                <button class="conversation-select" type="button" onclick={() => { deleteConfirmId = ""; void selectProjectSession(item.conversationId); }}>
                  <span class="conversation-text">
                    <strong title={item.title}>{item.title}</strong>
                    <small>{formatSessionTime(item.updatedAt)}</small>
                  </span>
                </button>
                <div class="conversation-actions">
                  <button type="button" aria-label={copy.rename} title={copy.rename} onclick={() => beginRename(item)}><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                  <button type="button" class="danger-action" aria-label={copy.delete} title={copy.delete} onclick={(event) => requestDelete(item, event)}><i class="ph ph-trash" aria-hidden="true"></i></button>
                </div>
                {#if deleteConfirmId === item.conversationId}
                  <div class="conversation-popover" role="alertdialog" aria-modal="false" aria-label={copy.deleteConversationTitle} style={`position:fixed;top:${deleteAnchor.top - 8}px;left:${deleteAnchor.left}px;width:${Math.max(deleteAnchor.width, 220)}px;transform:translateY(-100%);`}>
                    <strong>{copy.deleteConversationTitle}</strong>
                    <p>{copy.deleteConversationHint}</p>
                    <div class="conversation-popover-actions">
                      <button class="secondary-button" type="button" onclick={cancelDelete}>{copy.cancel}</button>
                      <button class="secondary-button danger-action" type="button" onclick={() => confirmDelete(item)}>{copy.delete}</button>
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
          {/each}
          <button class="conv-new-session" type="button" onclick={() => void newProjectSession()}><i class="ph ph-plus" aria-hidden="true"></i>{copy.newChat}</button>
        {/if}
      </div>
    {/each}
  </div>
</aside>
