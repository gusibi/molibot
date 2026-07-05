import {
  createDesktopProject,
  createDesktopProjectSession,
  deleteDesktopProject,
  deleteDesktopProjectSession,
  loadDesktopProjectSession,
  loadDesktopProjectSessions,
  loadDesktopProjects,
  renameDesktopProjectSession,
  type DesktopProject,
  type DesktopProjectMessage,
  type DesktopProjectSession
} from "../api";

export const projectsStore = $state({
  endpoint: "",
  projects: [] as DesktopProject[],
  selectedProjectId: "",
  sessions: [] as DesktopProjectSession[],
  selectedSessionId: "",
  messages: [] as DesktopProjectMessage[],
  loading: false,
  busy: "",
  error: ""
});

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

export async function addProject(input: { name: string; rootPath: string; instructions?: string }): Promise<boolean> {
  if (!projectsStore.endpoint || projectsStore.busy) return false;
  projectsStore.busy = "add";
  projectsStore.error = "";
  try {
    const project = await createDesktopProject(projectsStore.endpoint, input);
    projectsStore.projects = [project, ...projectsStore.projects];
    await selectProject(project.id);
    return true;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    projectsStore.busy = "";
  }
}

export async function selectProject(id: string): Promise<void> {
  projectsStore.selectedProjectId = id;
  projectsStore.selectedSessionId = "";
  projectsStore.messages = [];
  await loadProjectSessions(id);
  if (projectsStore.sessions.length === 0) await createAndSelectProjectSession(id);
}

async function createAndSelectProjectSession(projectId: string): Promise<void> {
  const id = await createDesktopProjectSession(projectsStore.endpoint, projectId);
  projectsStore.sessions = await loadDesktopProjectSessions(projectsStore.endpoint, projectId);
  await selectProjectSession(id);
}

export async function loadProjectSessions(id: string): Promise<void> {
  if (!projectsStore.endpoint || !id) { projectsStore.sessions = []; return; }
  projectsStore.sessions = await loadDesktopProjectSessions(projectsStore.endpoint, id);
  if (projectsStore.sessions[0]) await selectProjectSession(projectsStore.sessions[0].conversationId);
}

export async function selectProjectSession(id: string): Promise<void> {
  projectsStore.selectedSessionId = id;
  try {
    const messages = await loadDesktopProjectSession(projectsStore.endpoint, projectsStore.selectedProjectId, id);
    // Guard against out-of-order responses: the initial auto-select (loadProjectSessions)
    // and a user click can be in flight at the same time. Only write the transcript if this
    // response still matches the active session, otherwise a slower earlier fetch would
    // clobber the newly selected session's messages (first-open "click doesn't switch" bug).
    if (projectsStore.selectedSessionId !== id) return;
    projectsStore.messages = messages;
  } catch (cause) {
    if (projectsStore.selectedSessionId !== id) return;
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  }
}

// Refresh session titles/order after a turn without changing the active session
// (unlike loadProjectSessions, which auto-selects the most recent conversation).
export async function refreshProjectSessionList(id: string): Promise<void> {
  if (!projectsStore.endpoint || !id) return;
  try {
    projectsStore.sessions = await loadDesktopProjectSessions(projectsStore.endpoint, id);
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
    const remaining = projectsStore.sessions.filter((item) => item.conversationId !== conversationId);
    projectsStore.sessions = remaining;
    if (projectsStore.selectedSessionId === conversationId) {
      const next = remaining[0]?.conversationId ?? "";
      if (next) await selectProjectSession(next);
      else {
        projectsStore.selectedSessionId = "";
        projectsStore.messages = [];
        await createAndSelectProjectSession(projectsStore.selectedProjectId);
      }
    }
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  }
}

export async function removeProject(removeSessions: boolean): Promise<void> {
  if (!projectsStore.selectedProjectId || projectsStore.busy) return;
  projectsStore.busy = "delete";
  try {
    await deleteDesktopProject(projectsStore.endpoint, projectsStore.selectedProjectId, removeSessions);
    projectsStore.selectedProjectId = "";
    await loadProjects(projectsStore.endpoint);
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    projectsStore.busy = "";
  }
}
