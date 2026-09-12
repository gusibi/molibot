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
import { invoke } from "@tauri-apps/api/core";
import { invalidateComposerSuggestions } from "../chat/composerSuggestions.svelte";
import { toStore } from "svelte/store";
import { projectChatStore } from "../projects/projectChatStore.svelte";

export const projectsStore = $state({
  endpoint: "",
  projects: [] as DesktopProject[],
  selectedProjectId: "",
  sessionsByProject: {} as Record<string, DesktopProjectSession[]>,
  sessionListLoading: {} as Record<string, boolean>,
  sessionListErrors: {} as Record<string, string>,
  get sessions(): DesktopProjectSession[] {
    return this.sessionsByProject[this.selectedProjectId] ?? [];
  },
  selectedSessionId: "",
  messages: [] as DesktopProjectMessage[],
  loading: false,
  messagesLoading: false,
  busy: "",
  pickingFolder: false,
  error: ""
});

/**
 * Store projection of `projectsStore` for legacy `$:` consumers (pitfall #2).
 *
 * A legacy reactive statement compiles to `legacy_pre_effect(deps, fn)` where
 * only `deps` is tracked and `fn` runs inside `untrack`. For an imported runes
 * `$state` object the compiler emits `reactive_import(() => projectsStore)` as
 * the dep, whose signal bumps only if the BINDING is reassigned — never when a
 * property changes. So `$: if (projectsStore.selectedSessionId) …` runs exactly
 * once, at mount, and silently goes stale forever after (shipped symptom: a
 * project session's images fell back to filename chips because the session-file
 * list was still the one fetched for whichever session was open at mount).
 * Templates are unaffected — the compiler emits `deep_read_state` there.
 *
 * Reading `$projectsView.selectedSessionId` inside a `$:` restores tracking,
 * mirroring the `$conversationView` pattern used for the turn controller.
 */
export const projectsView = toStore(() => ({
  endpoint: projectsStore.endpoint,
  projects: projectsStore.projects,
  selectedProjectId: projectsStore.selectedProjectId,
  sessions: projectsStore.sessions,
  selectedSessionId: projectsStore.selectedSessionId,
  messagesLoading: projectsStore.messagesLoading
}));

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
    projectsStore.sessionsByProject[project.id] = [];
    return true;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    projectsStore.busy = "";
  }
}

/**
 * Opens the native folder picker for "use an existing folder".
 *
 * The in-flight flag lives in the store, not in a component, because both project
 * surfaces (sidebar tree and list) render a create dialog: a per-component guard
 * would still let two pickers open. Returns "" when the user cancels.
 */
export async function pickProjectDirectory(): Promise<string> {
  if (projectsStore.pickingFolder || projectsStore.busy === "add") return "";
  projectsStore.pickingFolder = true;
  projectsStore.error = "";
  try {
    return (await invoke<string | null>("pick_project_directory")) ?? "";
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return "";
  } finally {
    projectsStore.pickingFolder = false;
  }
}

export async function selectProject(id: string): Promise<void> {
  ++projectSelectionGeneration;
  projectsStore.selectedProjectId = id;
  projectsStore.selectedSessionId = "";
  projectsStore.messages = [];
  projectsStore.error = "";
  await refreshProjectSessionList(id);
}

async function createAndSelectProjectSession(projectId: string, projectGeneration = projectSelectionGeneration): Promise<void> {
  const { session } = await createDesktopProjectSession(projectsStore.endpoint, projectId);
  // Show the created session immediately (server lists are newest-first). The
  // follow-up refresh owns the canonical order; if it fails, the session stays
  // visible here instead of vanishing behind an error banner.
  const existing = projectsStore.sessionsByProject[projectId] ?? [];
  if (!existing.some((item) => item.conversationId === session.conversationId)) {
    projectsStore.sessionsByProject[projectId] = [session, ...existing];
  }
  await refreshProjectSessionList(projectId, true);
  if (projectGeneration !== projectSelectionGeneration || projectsStore.selectedProjectId !== projectId) return;
  await selectProjectSession(session.conversationId, projectId);
}

export async function selectProjectSession(id: string, projectId = projectsStore.selectedProjectId): Promise<void> {
  const generation = ++sessionSelectionGeneration;
  ++projectSelectionGeneration;
  projectsStore.selectedProjectId = projectId;
  projectsStore.selectedSessionId = id;
  // Cache-first: a session the user already opened keeps its transcript in its
  // pinned registry entry, so show that immediately and revalidate behind it.
  // Clearing to `[]` here made EVERY re-visit pay the full round trip plus a
  // cold markdown/highlight pass behind the "loading conversation" spinner,
  // which is what made switching between sessions feel slow.
  const cached = projectChatStore.cachedMessages(id);
  // The project store owns transcript loading. Activate the pinned runtime and
  // carry one hydration lease across the request: if a turn starts before the
  // response commits, its cached transcript + live row keep display ownership.
  const hydration = projectChatStore.selectSession(id, projectId, cached);
  projectsStore.messages = cached as unknown as DesktopProjectMessage[];
  projectsStore.messagesLoading = cached.length === 0;
  projectsStore.error = "";
  try {
    const loaded = await loadDesktopProjectSession(projectsStore.endpoint, projectId, id);
    if (generation !== sessionSelectionGeneration || projectsStore.selectedProjectId !== projectId || projectsStore.selectedSessionId !== id) return;
    const messages = loaded.messages as NonNullable<Parameters<typeof projectChatStore.selectSession>[2]>;
    const committed = hydration?.commit(messages, loaded.usage);
    if (committed !== false) projectsStore.messages = messages;
  } catch (cause) {
    if (generation !== sessionSelectionGeneration || projectsStore.selectedProjectId !== projectId || projectsStore.selectedSessionId !== id) return;
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (generation === sessionSelectionGeneration && projectsStore.selectedProjectId === projectId && projectsStore.selectedSessionId === id) {
      projectsStore.messagesLoading = false;
    }
  }
}

// Only the latest request for a project may publish, including after a mutation.
const sessionListRequests = new Map<string, Promise<void>>();
let listEndpoint = "";

function invalidateSessionList(id: string): void {
  sessionListRequests.delete(id);
  projectsStore.sessionListLoading[id] = false;
  // A mutation just succeeded, so a previously failed list read is stale news.
  projectsStore.sessionListErrors[id] = "";
}

export function refreshProjectSessionList(id: string, force = false): Promise<void> {
  const endpoint = projectsStore.endpoint;
  if (!endpoint || !id) return Promise.resolve();
  if (listEndpoint !== endpoint) {
    listEndpoint = endpoint;
    sessionListRequests.clear();
    projectsStore.sessionsByProject = {};
    projectsStore.sessionListLoading = {};
    projectsStore.sessionListErrors = {};
  }
  const pending = sessionListRequests.get(id);
  if (pending && !force) return pending;
  projectsStore.sessionListLoading[id] = true;
  projectsStore.sessionListErrors[id] = "";
  const request = Promise.resolve().then(async () => {
    const ownsResult = () => projectsStore.endpoint === endpoint && sessionListRequests.get(id) === request;
    try {
      const sessions = await loadDesktopProjectSessions(endpoint, id);
      if (ownsResult()) projectsStore.sessionsByProject[id] = sessions;
    } catch (cause) {
      if (ownsResult()) {
        const error = cause instanceof Error ? cause.message : String(cause);
        projectsStore.sessionListErrors[id] = error;
        projectsStore.error = error;
      }
    } finally {
      if (ownsResult()) {
        projectsStore.sessionListLoading[id] = false;
        sessionListRequests.delete(id);
      }
    }
  });
  sessionListRequests.set(id, request);
  return request;
}

export async function newProjectSession(projectId = projectsStore.selectedProjectId): Promise<void> {
  if (!projectId || projectsStore.busy) return;
  ++projectSelectionGeneration;
  projectsStore.selectedProjectId = projectId;
  projectsStore.busy = "session";
  try {
    await createAndSelectProjectSession(projectId);
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    projectsStore.busy = "";
  }
}

export async function renameProjectSession(conversationId: string, title: string, projectId = projectsStore.selectedProjectId): Promise<void> {
  if (!projectsStore.endpoint || !projectId) return;
  try {
    const updated = await renameDesktopProjectSession(projectsStore.endpoint, projectId, conversationId, title);
    invalidateSessionList(projectId);
    projectsStore.sessionsByProject[projectId] = (projectsStore.sessionsByProject[projectId] ?? []).map((item) => item.conversationId === updated.conversationId ? updated : item);
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
  }
}

export async function removeProjectSession(conversationId: string, projectId = projectsStore.selectedProjectId): Promise<void> {
  if (!projectsStore.endpoint || !projectId) return;
  try {
    await deleteDesktopProjectSession(projectsStore.endpoint, projectId, conversationId);
    invalidateSessionList(projectId);
    // Tear down the deleted session's pinned runtime so its controller/state is
    // not left orphaned (parity with the main chat's delete → disposeSession).
    projectChatStore.disposeSession(conversationId);
    const remaining = (projectsStore.sessionsByProject[projectId] ?? []).filter((item) => item.conversationId !== conversationId);
    projectsStore.sessionsByProject[projectId] = remaining;
    if (projectsStore.selectedProjectId === projectId && projectsStore.selectedSessionId === conversationId) {
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
    invalidateSessionList(projectId);
    delete projectsStore.sessionsByProject[projectId];
    delete projectsStore.sessionListLoading[projectId];
    delete projectsStore.sessionListErrors[projectId];
    if (projectsStore.selectedProjectId === projectId) {
      projectsStore.selectedProjectId = "";
      projectsStore.selectedSessionId = "";
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
  patch: { name: string; instructions: string; modelKey: string | null; thinkingLevel: DesktopProject["thinkingLevel"] | null; toolProgress: DesktopProject["toolProgress"] | null; showReasoning: DesktopProject["showReasoning"] | null; runLogNotice: boolean | null; customCommands: DesktopProject["customCommands"] }
): Promise<boolean> {
  if (!projectId || !projectsStore.endpoint || projectsStore.busy) return false;
  projectsStore.busy = "project-settings";
  projectsStore.error = "";
  try {
    const updated = await patchDesktopProject(projectsStore.endpoint, projectId, patch);
    projectsStore.projects = projectsStore.projects.map((item) => item.id === projectId ? updated : item);
    // Custom commands feed the `/` composer palette; drop the cache so the
    // Project composer reflects the edit without a WebView reload.
    invalidateComposerSuggestions();
    return true;
  } catch (cause) {
    projectsStore.error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    projectsStore.busy = "";
  }
}
