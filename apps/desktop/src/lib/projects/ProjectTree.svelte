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
      if (rootPath) await createProject({ name: name.trim(), rootPath });
    } catch (cause) {
      projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<div class="project-tree">
  <div class="project-tree-head" class:open={expanded}>
    <button type="button" class="project-tree-toggle" aria-expanded={expanded} onclick={onToggle}>
      <i class="ph-fill ph-folders" aria-hidden="true"></i><span>{copy.projects}</span><i class="ph ph-caret-right project-tree-caret" class:open={expanded} aria-hidden="true"></i>
    </button>
    <button type="button" class="project-add" aria-label={copy.addProject} title={copy.addProject} onclick={() => void beginAdding()}><i class="ph ph-plus" aria-hidden="true"></i></button>
  </div>
  {#if expanded}
    {#each projectsStore.projects as project (project.id)}
      {@const projectSessions = project.id === projectsStore.selectedProjectId ? projectsStore.sessions : (sessionsByProject[project.id] ?? [])}
      <div class="project-tree-group">
        <GroupHeader label={project.name} icon="ph-fill ph-folder" open={Boolean(expandedProjects[project.id])} actionLabel={copy.newChat} onAction={() => void createSession(project.id)} onToggle={() => toggleProject(project.id)} />
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
        <div class="project-form-actions project-location-actions"><button class="secondary-button" type="button" disabled={projectsStore.busy === "add"} onclick={() => (createStep = "name")}>{copy.back}</button><button class="secondary-button" type="button" disabled={projectsStore.busy === "add"} onclick={cancelAdding}>{copy.cancel}</button></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .project-tree { min-width: 0; padding: 2px 0 6px; }
  .project-tree-head { display: flex; align-items: center; min-height: 34px; padding: 0 4px; }
  .project-tree-toggle { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 34px; padding: 0 4px; border: 0; background: transparent; color: var(--label-primary); font: inherit; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer; }
  .project-tree-toggle > i:first-child { color: var(--label-secondary); font-size: 16px; }
  .project-tree-toggle span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .project-tree-caret, .project-add { opacity: 0; pointer-events: none; transition: opacity .12s ease, transform .12s ease; }
  .project-tree-head:hover .project-tree-caret, .project-tree-head:hover .project-add, .project-tree-head:focus-within .project-tree-caret, .project-tree-head:focus-within .project-add { opacity: 1; pointer-events: auto; }
  .project-tree-caret { font-size: 11px; color: var(--label-tertiary); }
  .project-tree-caret.open { transform: rotate(90deg); }
  .project-add { display: grid; place-items: center; flex: 0 0 auto; width: 24px; height: 24px; margin-right: 2px; padding: 0; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--label-tertiary); cursor: pointer; }
  .project-add:hover { background: var(--fill); color: var(--label-primary); }
  .project-tree-state { margin: 0; padding: 6px 12px 6px 32px; color: var(--label-tertiary); font-size: 12px; }
</style>
