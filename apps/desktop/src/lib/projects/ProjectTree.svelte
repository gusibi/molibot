<script lang="ts">
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { Translation } from "../i18n";
  import {
    deleteDesktopProjectSession,
    loadDesktopProjectSessions,
    renameDesktopProjectSession,
    type DesktopProjectSession
  } from "../api";
  import ConversationRow from "../chat/ConversationRow.svelte";
  import GroupHeader from "../chat/GroupHeader.svelte";
  import {
    addProject,
    newProjectSession,
    projectsStore,
    removeProject,
    renameProject,
    selectProjectSession
  } from "../stores/projects.svelte";

  let {
    copy,
    endpoint,
    expanded,
    activeSessionId = "",
    formatTime,
    onToggle,
    onActivateSession
  }: {
    copy: Translation;
    endpoint: string;
    expanded: boolean;
    activeSessionId?: string;
    formatTime: (value: string) => string;
    onToggle: () => void;
    onActivateSession: () => void;
  } = $props();

  const EXPANSION_KEY = "molibot-desktop-expanded-projects";
  let loadedEndpoint = "";
  let expandedProjects = $state<Record<string, boolean>>(readExpandedProjects());
  let sessionsByProject = $state<Record<string, DesktopProjectSession[]>>({});
  let loadingProjects = $state<Record<string, boolean>>({});
  let adding = $state(false);
  let createStep = $state<"name" | "location">("name");
  let name = $state("");
  let selectedRootPath = $state("");
  let deleteProjectId = $state("");
  let deleteProjectSessions = $state(false);
  let menuProjectId = $state("");
  let renameProjectId = $state("");
  let renameProjectName = $state("");
  let nameInput = $state<HTMLInputElement>();

  const rowLabels = $derived({
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
  });

  $effect(() => {
    if (!menuProjectId) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".project-row-menu") || target?.closest(".conv-group-menu")) return;
      menuProjectId = "";
    };
    window.addEventListener("pointerdown", closeMenu, true);
    return () => window.removeEventListener("pointerdown", closeMenu, true);
  });

  function readExpandedProjects(): Record<string, boolean> {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXPANSION_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed as Record<string, boolean> : {};
    } catch {
      return {};
    }
  }

  function persistExpandedProjects(): void {
    localStorage.setItem(EXPANSION_KEY, JSON.stringify(expandedProjects));
  }

  $effect(() => {
    if (!endpoint || endpoint === loadedEndpoint) return;
    loadedEndpoint = endpoint;
    projectsStore.endpoint = endpoint;
    void loadProjects();
  });

  async function loadProjects(): Promise<void> {
    const { loadDesktopProjects } = await import("../api");
    try {
      projectsStore.projects = await loadDesktopProjects(endpoint);
      for (const project of projectsStore.projects) {
        if (expandedProjects[project.id]) void loadSessions(project.id);
      }
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadSessions(projectId: string): Promise<void> {
    if (!endpoint || loadingProjects[projectId]) return;
    loadingProjects = { ...loadingProjects, [projectId]: true };
    try {
      sessionsByProject = { ...sessionsByProject, [projectId]: await loadDesktopProjectSessions(endpoint, projectId) };
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loadingProjects = { ...loadingProjects, [projectId]: false };
    }
  }

  function toggleProject(projectId: string): void {
    const open = !expandedProjects[projectId];
    expandedProjects = { ...expandedProjects, [projectId]: open };
    persistExpandedProjects();
    if (open) void loadSessions(projectId);
  }

  async function openSession(projectId: string, sessionId: string): Promise<void> {
    projectsStore.selectedProjectId = projectId;
    projectsStore.sessions = sessionsByProject[projectId] ?? [];
    await selectProjectSession(sessionId, projectId);
    onActivateSession();
  }

  async function createSession(projectId: string): Promise<void> {
    projectsStore.selectedProjectId = projectId;
    projectsStore.sessions = sessionsByProject[projectId] ?? [];
    await newProjectSession();
    await loadSessions(projectId);
    onActivateSession();
  }

  async function renameSession(projectId: string, sessionId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || !endpoint) return;
    try {
      const updated = await renameDesktopProjectSession(endpoint, projectId, sessionId, trimmed);
      sessionsByProject = {
        ...sessionsByProject,
        [projectId]: (sessionsByProject[projectId] ?? []).map((item) => item.conversationId === sessionId ? updated : item)
      };
      if (projectsStore.selectedProjectId === projectId) {
        projectsStore.sessions = sessionsByProject[projectId];
      }
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function deleteSession(projectId: string, sessionId: string): Promise<void> {
    if (!endpoint) return;
    try {
      await deleteDesktopProjectSession(endpoint, projectId, sessionId);
      const remaining = (sessionsByProject[projectId] ?? []).filter((item) => item.conversationId !== sessionId);
      sessionsByProject = { ...sessionsByProject, [projectId]: remaining };
      if (projectsStore.selectedProjectId === projectId && projectsStore.selectedSessionId === sessionId) {
        projectsStore.sessions = remaining;
        projectsStore.selectedSessionId = "";
        projectsStore.messages = [];
        if (remaining[0]) await openSession(projectId, remaining[0].conversationId);
        else onActivateSession();
      }
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
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
    if (projectsStore.busy === "add") return;
    adding = false;
    createStep = "name";
    name = "";
    selectedRootPath = "";
  }

  async function createProject(input: { name: string; rootPath?: string; createDirectory?: boolean }): Promise<void> {
    if (await addProject(input)) {
      const project = projectsStore.projects[0];
      if (project) {
        expandedProjects = { ...expandedProjects, [project.id]: true };
        persistExpandedProjects();
        sessionsByProject = { ...sessionsByProject, [project.id]: [] };
      }
      cancelAdding();
    }
  }

  async function useExistingProjectFolder(): Promise<void> {
    try {
      const rootPath = await invoke<string | null>("pick_project_directory");
      if (rootPath) selectedRootPath = rootPath;
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function askToRemoveProject(projectId: string): void {
    menuProjectId = "";
    deleteProjectId = projectId;
    deleteProjectSessions = false;
  }

  function askToRenameProject(projectId: string, currentName: string): void {
    menuProjectId = "";
    renameProjectId = projectId;
    renameProjectName = currentName;
  }

  function cancelRenameProject(): void {
    if (projectsStore.busy === "rename-project") return;
    renameProjectId = "";
    renameProjectName = "";
  }

  async function confirmRenameProject(): Promise<void> {
    if (!renameProjectId || !renameProjectName.trim()) return;
    if (await renameProject(renameProjectId, renameProjectName)) cancelRenameProject();
  }

  function cancelRemoveProject(): void {
    if (projectsStore.busy === "delete") return;
    deleteProjectId = "";
    deleteProjectSessions = false;
  }

  async function confirmRemoveProject(): Promise<void> {
    if (!deleteProjectId) return;
    const projectId = deleteProjectId;
    if (!(await removeProject(deleteProjectId, deleteProjectSessions))) return;
    const { [projectId]: _sessions, ...remainingSessions } = sessionsByProject;
    const { [projectId]: _expanded, ...remainingExpanded } = expandedProjects;
    sessionsByProject = remainingSessions;
    expandedProjects = remainingExpanded;
    persistExpandedProjects();
    cancelRemoveProject();
  }
</script>

<div class="project-tree">
  <div class="project-tree-head" class:open={expanded}>
    <button type="button" class="project-tree-toggle" aria-expanded={expanded} onclick={onToggle}>
      <span>{copy.projects}</span><i class="ph ph-caret-right project-tree-caret" class:open={expanded} aria-hidden="true"></i>
    </button>
    <button type="button" class="project-add" aria-label={copy.addProject} title={copy.addProject} onclick={() => void beginAdding()}><i class="ph ph-plus" aria-hidden="true"></i></button>
  </div>
  {#if expanded}
    {#each projectsStore.projects as project (project.id)}
      {@const projectSessions = project.id === projectsStore.selectedProjectId ? projectsStore.sessions : (sessionsByProject[project.id] ?? [])}
      <div class="project-tree-group">
        <GroupHeader label={project.name} icon="ph-fill ph-folder" open={Boolean(expandedProjects[project.id])} actionLabel={copy.newChat} onAction={() => void createSession(project.id)} menuLabel={copy.conversationMenu} onMenu={() => (menuProjectId = menuProjectId === project.id ? "" : project.id)} onToggle={() => toggleProject(project.id)} />
        {#if menuProjectId === project.id}
          <div class="project-row-menu" role="menu">
            <button type="button" role="menuitem" onclick={() => askToRenameProject(project.id, project.name)}><i class="ph ph-pencil-simple" aria-hidden="true"></i><span>{copy.renameProject}</span></button>
            <button type="button" role="menuitem" class="danger-action" onclick={() => askToRemoveProject(project.id)}><i class="ph ph-trash" aria-hidden="true"></i><span>{copy.deleteProject}</span></button>
          </div>
        {/if}
        {#if expandedProjects[project.id]}
          {#if loadingProjects[project.id]}
            <p class="project-tree-state">…</p>
          {:else if projectSessions.length === 0}
            <p class="project-tree-state">{copy.projectNoSessions}</p>
          {:else}
            {#each projectSessions as session (session.conversationId)}
              <ConversationRow
                item={{ title: session.title, updatedAt: session.updatedAt, readOnly: false, botId: project.id, botName: project.name, botDeleted: false }}
                active={activeSessionId === session.conversationId}
                formatTime={formatTime}
                labels={rowLabels}
                onSelect={() => void openSession(project.id, session.conversationId)}
                onRename={(title) => void renameSession(project.id, session.conversationId, title)}
                onDelete={() => void deleteSession(project.id, session.conversationId)}
              />
            {/each}
          {/if}
        {/if}
      </div>
    {/each}
  {/if}
</div>

{#if adding}
  <div class="project-dialog-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && cancelAdding()}>
    <div class="project-dialog project-create-dialog" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
      <div class="project-dialog-heading"><span class="project-dialog-icon" aria-hidden="true"><i class="ph-fill ph-folder-plus"></i></span><div><h2 id="project-create-title">{copy.projectCreateTitle}</h2><p>{createStep === "name" ? copy.projectCreateNameHint : copy.projectChooseLocationHint}</p></div></div>
      {#if createStep === "name"}
        <form onsubmit={(event) => { event.preventDefault(); if (name.trim()) createStep = "location"; }}><label class="project-name-field"><span>{copy.projectName}</span><input bind:this={nameInput} bind:value={name} autocomplete="off" required placeholder={copy.projectNamePlaceholder} /></label><div class="project-form-actions"><button class="secondary-button" type="button" onclick={cancelAdding}>{copy.cancel}</button><button class="primary-button" disabled={!name.trim()}>{copy.continueAction}</button></div></form>
      {:else}
        <div class="project-location-options" aria-label={copy.projectChooseLocation}><button type="button" class="project-location-option" disabled={projectsStore.busy === "add"} onclick={() => void createProject({ name: name.trim(), createDirectory: true })}><span class="project-location-icon"><i class="ph-fill ph-folder-simple-plus" aria-hidden="true"></i></span><span><strong>{copy.projectCreateFolder}</strong><small>{copy.projectCreateFolderHint}</small></span><i class="ph ph-arrow-right" aria-hidden="true"></i></button><button type="button" class="project-location-option" disabled={projectsStore.busy === "add"} onclick={() => void useExistingProjectFolder()}><span class="project-location-icon"><i class="ph-fill ph-folder-open" aria-hidden="true"></i></span><span><strong>{copy.projectUseExistingFolder}</strong><small>{copy.projectUseExistingFolderHint}</small></span><i class="ph ph-arrow-right" aria-hidden="true"></i></button></div>
        {#if selectedRootPath}<div class="project-selected-location"><i class="ph-fill ph-folder-open" aria-hidden="true"></i><span><small>{copy.projectSelectedLocation}</small><strong>{selectedRootPath}</strong></span></div>{/if}
        <div class="project-form-actions project-location-actions"><button class="secondary-button" type="button" disabled={projectsStore.busy === "add"} onclick={() => (createStep = "name")}>{copy.back}</button><button class="secondary-button" type="button" disabled={projectsStore.busy === "add"} onclick={cancelAdding}>{copy.cancel}</button><button class="primary-button" type="button" disabled={!selectedRootPath || projectsStore.busy === "add"} onclick={() => void createProject({ name: name.trim(), rootPath: selectedRootPath })}>{copy.projectCreateAction}</button></div>
      {/if}
    </div>
  </div>
{/if}

{#if renameProjectId}
  <div class="project-dialog-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && cancelRenameProject()}>
    <div class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-rename-title">
      <form onsubmit={(event) => { event.preventDefault(); void confirmRenameProject(); }}>
        <h2 id="project-rename-title">{copy.renameProject}</h2>
        <label class="project-name-field"><span>{copy.projectName}</span><input bind:value={renameProjectName} autocomplete="off" required /></label>
        <div class="project-form-actions">
          <button class="secondary-button" type="button" disabled={projectsStore.busy === "rename-project"} onclick={cancelRenameProject}>{copy.cancel}</button>
          <button class="primary-button" disabled={!renameProjectName.trim() || projectsStore.busy === "rename-project"}>{copy.save}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if deleteProjectId}
  {@const deleteTarget = projectsStore.projects.find((item) => item.id === deleteProjectId)}
  <div class="project-dialog-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && cancelRemoveProject()}>
    <div class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-delete-title">
      <h2 id="project-delete-title">{copy.projectDeleteTitle}</h2>
      {#if deleteTarget}<p><strong>{deleteTarget.name}</strong></p>{/if}
      <p>{copy.projectDeleteNotice}</p>
      <label class="project-delete-option"><input type="checkbox" bind:checked={deleteProjectSessions} disabled={projectsStore.busy === "delete"} /><span>{copy.projectDeleteSessions}</span></label>
      <div class="project-form-actions">
        <button class="secondary-button" type="button" disabled={projectsStore.busy === "delete"} onclick={cancelRemoveProject}>{copy.cancel}</button>
        <button class="error-button" type="button" disabled={projectsStore.busy === "delete"} onclick={() => void confirmRemoveProject()}>{copy.deleteProject}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .project-tree { min-width: 0; padding: 0 0 8px; }
  .project-tree-group { position: relative; padding-left: 8px; }
  .project-row-menu { position: absolute; z-index: 20; top: 32px; right: 8px; display: grid; width: 148px; padding: 4px; border: 1px solid var(--separator); border-radius: var(--rounded-sm); background: var(--card-bg); box-shadow: var(--popover-shadow); }
  .project-row-menu button { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 8px; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--label-primary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
  .project-row-menu button:hover { background: var(--fill); }
  .project-row-menu button.danger-action { color: var(--danger); }
  .project-tree-head { display: flex; align-items: center; min-height: 32px; padding: 0 4px; }
  .project-tree-toggle { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 32px; padding: 0 4px; border: 0; background: transparent; color: var(--label-secondary); font: inherit; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer; }
  .project-tree-toggle span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .project-tree-caret, .project-add { opacity: 0; pointer-events: none; transition: opacity var(--duration-instant) var(--ease-standard), transform var(--duration-instant) var(--ease-standard); }
  .project-tree-head:hover .project-tree-caret, .project-tree-head:hover .project-add, .project-tree-head:focus-within .project-tree-caret, .project-tree-head:focus-within .project-add { opacity: 1; pointer-events: auto; }
  .project-tree-caret { font-size: 11px; color: var(--label-tertiary); }
  .project-tree-caret.open { transform: rotate(90deg); }
  .project-add { display: grid; place-items: center; flex: 0 0 auto; width: 24px; height: 24px; margin-right: 2px; padding: 0; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--label-tertiary); cursor: pointer; }
  .project-add:hover { background: var(--fill); color: var(--label-primary); }
  .project-tree-state { margin: 0; padding: 6px 12px 6px 32px; color: var(--label-tertiary); font-size: 12px; }
</style>
