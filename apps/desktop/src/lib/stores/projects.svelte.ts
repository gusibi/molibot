import {
  createDesktopProject,
  createDesktopProjectSession,
  deleteDesktopProject,
  deleteDesktopProjectSession,
  loadDesktopProjectSession,
  loadDesktopProjectSessions,
  loadDesktopProjects,
  patchDesktopProject,
  renameDesktopProjectSession,
  type DesktopProject,
  type DesktopProjectMessage,
  type DesktopProjectSession
} from "../api";
import { projectChatStore } from "../projects/projectChatStore.svelte";

export const projectsStore = $state({
  endpoint: "",
  projects: [] as DesktopProject[],
  selectedProjectId: "",
  sessions: [] as DesktopProjectSession[],
  selectedSessionId: "",
  messages: [] as DesktopProjectMessage[],
  loading: false,
  messagesLoading: false,
  busy: "",
  error: ""
});

let projectSelectionGeneration = 0;
let sessionSelectionGeneration = 0;

export async function loadProjects(endpoint: string): Promise<void> {
  projectsStore.endpoint = endpoint;
  projectsStore.loading = true;
  projectsStore.error = "";
  try {
    projectsStore.projects = await loadDesktopProjects(endpoint);
    if (!projectsStore.projects.some((item) => item.id === projectsStore.selectedProjectId)) {
      projectsStore.selectedProjectId = projectsStore.projects[0]?.id ?? "";
    }
    if (projectsStore.selectedProjectId) await selectProject(projectsStore.selectedProjectId);
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    projectsStore.loading = false;
  }
}

export async function addProject(input: { name: string; rootPath?: string; createDirectory?: boolean; instructions?: string }): Promise<boolean> {
  if (!projectsStore.endpoint || projectsStore.busy) return false;
  projectsStore.busy = "add";
  projectsStore.error = "";
  try {
    const project = await createDesktopProject(projectsStore.endpoint, input);
    projectsStore.projects = [project, ...projectsStore.projects];
    return true;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    projectsStore.busy = "";
  }
}

export async function selectProject(id: string): Promise<void> {
  const generation = ++projectSelectionGeneration;
  projectsStore.selectedProjectId = id;
  projectsStore.selectedSessionId = "";
  projectsStore.sessions = [];
  projectsStore.messages = [];
  projectsStore.error = "";
  try {
    const sessions = await loadDesktopProjectSessions(projectsStore.endpoint, id);
    if (generation !== projectSelectionGeneration || projectsStore.selectedProjectId !== id) return;
    projectsStore.sessions = sessions;
  } catch (cause) {
    if (generation !== projectSelectionGeneration || projectsStore.selectedProjectId !== id) return;
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  }
}

async function createAndSelectProjectSession(projectId: string, projectGeneration = projectSelectionGeneration): Promise<void> {
  const { session } = await createDesktopProjectSession(projectsStore.endpoint, projectId);
  const sessions = await loadDesktopProjectSessions(projectsStore.endpoint, projectId);
  if (projectGeneration !== projectSelectionGeneration || projectsStore.selectedProjectId !== projectId) return;
  projectsStore.sessions = sessions;
  await selectProjectSession(session.conversationId, projectId);
}

export async function selectProjectSession(id: string, projectId = projectsStore.selectedProjectId): Promise<void> {
  const generation = ++sessionSelectionGeneration;
  projectsStore.selectedSessionId = id;
  // The project store owns transcript loading. Activate an empty pinned runtime
  // immediately, then hydrate that same runtime from the successful response so
  // the UI cannot diverge from this authoritative request.
  projectChatStore.selectSession(id, projectId, []);
  projectsStore.messages = [];
  projectsStore.messagesLoading = true;
  projectsStore.error = "";
  try {
    const messages = await loadDesktopProjectSession(projectsStore.endpoint, projectId, id);
    if (generation !== sessionSelectionGeneration || projectsStore.selectedProjectId !== projectId || projectsStore.selectedSessionId !== id) return;
    projectsStore.messages = messages;
    projectChatStore.selectSession(id, projectId, messages as Parameters<typeof projectChatStore.selectSession>[2]);
  } catch (cause) {
    if (generation !== sessionSelectionGeneration || projectsStore.selectedProjectId !== projectId || projectsStore.selectedSessionId !== id) return;
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (generation === sessionSelectionGeneration && projectsStore.selectedProjectId === projectId && projectsStore.selectedSessionId === id) {
      projectsStore.messagesLoading = false;
    }
  }
}

// Refresh session titles/order after a turn without changing the active session.
export async function refreshProjectSessionList(id: string): Promise<void> {
  if (!projectsStore.endpoint || !id) return;
  try {
    const sessions = await loadDesktopProjectSessions(projectsStore.endpoint, id);
    if (projectsStore.selectedProjectId === id) projectsStore.sessions = sessions;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  }
}

export async function newProjectSession(): Promise<void> {
  if (!projectsStore.selectedProjectId || projectsStore.busy) return;
  projectsStore.busy = "session";
  try {
    await createAndSelectProjectSession(projectsStore.selectedProjectId);
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    projectsStore.busy = "";
  }
}

export async function renameProjectSession(conversationId: string, title: string): Promise<void> {
  if (!projectsStore.endpoint || !projectsStore.selectedProjectId) return;
  try {
    const updated = await renameDesktopProjectSession(projectsStore.endpoint, projectsStore.selectedProjectId, conversationId, title);
    projectsStore.sessions = projectsStore.sessions.map((item) => item.conversationId === updated.conversationId ? updated : item);
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  }
}

export async function removeProjectSession(conversationId: string): Promise<void> {
  if (!projectsStore.endpoint || !projectsStore.selectedProjectId) return;
  try {
    await deleteDesktopProjectSession(projectsStore.endpoint, projectsStore.selectedProjectId, conversationId);
    // Tear down the deleted session's pinned runtime so its controller/state is
    // not left orphaned (parity with the main chat's delete → disposeSession).
    projectChatStore.disposeSession(conversationId);
    const remaining = projectsStore.sessions.filter((item) => item.conversationId !== conversationId);
    projectsStore.sessions = remaining;
    if (projectsStore.selectedSessionId === conversationId) {
      const next = remaining[0]?.conversationId ?? "";
      if (next) await selectProjectSession(next);
      else {
        projectsStore.selectedSessionId = "";
        projectsStore.messages = [];
      }
    }
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  }
}

export async function removeProject(projectId: string, removeSessions: boolean): Promise<boolean> {
  if (!projectId || !projectsStore.endpoint || projectsStore.busy) return false;
  projectsStore.busy = "delete";
  projectsStore.error = "";
  try {
    await deleteDesktopProject(projectsStore.endpoint, projectId, removeSessions);
    projectsStore.projects = projectsStore.projects.filter((item) => item.id !== projectId);
    if (projectsStore.selectedProjectId === projectId) {
      projectsStore.selectedProjectId = "";
      projectsStore.selectedSessionId = "";
      projectsStore.sessions = [];
      projectsStore.messages = [];
    }
    return true;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    projectsStore.busy = "";
  }
}

export async function renameProject(projectId: string, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!projectId || !trimmed || !projectsStore.endpoint || projectsStore.busy) return false;
  projectsStore.busy = "rename-project";
  projectsStore.error = "";
  try {
    const updated = await patchDesktopProject(projectsStore.endpoint, projectId, { name: trimmed });
    projectsStore.projects = projectsStore.projects.map((item) => item.id === projectId ? updated : item);
    return true;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    projectsStore.busy = "";
  }
}

export async function saveProjectSettings(
  projectId: string,
  patch: { name: string; instructions: string; modelKey: string | null; thinkingLevel: DesktopProject["thinkingLevel"] | null; sandboxEnabled: boolean | null; toolProgress: DesktopProject["toolProgress"] | null; showReasoning: DesktopProject["showReasoning"] | null; runLogNotice: boolean | null }
): Promise<boolean> {
  if (!projectId || !projectsStore.endpoint || projectsStore.busy) return false;
  projectsStore.busy = "project-settings";
  projectsStore.error = "";
  try {
    const updated = await patchDesktopProject(projectsStore.endpoint, projectId, patch);
    projectsStore.projects = projectsStore.projects.map((item) => item.id === projectId ? updated : item);
    return true;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    projectsStore.busy = "";
  }
}
