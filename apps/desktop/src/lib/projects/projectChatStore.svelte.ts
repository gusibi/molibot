import { toStore } from "svelte/store";
import {
  SessionRuntimeRegistry,
  type SessionRuntimeDeps,
  type SessionRuntimeEntry
} from "../chat/sessionRuntimeRegistry.svelte";
import { SessionDraftStore } from "../chat/sessionDraftStore";
import type { ConversationLabels, UiMessage } from "../chat/conversationController.svelte";
import type { SessionStatusDot } from "../chat/sessionStatusDot";
import type {
  DesktopApprovalDecision,
  DesktopApprovalPrompt,
  DesktopThinkingLevel
} from "@molibot/desktop-contract";
import { loadDesktopProjectSession, type DesktopActivityEntry } from "../api";

/**
 * Project chat's per-session runtime store (parity with `ChatSessionStore` for
 * the main chat, plan "ProjectChat → SessionRuntimeRegistry"). Project chat used
 * to drive a SINGLE `ConversationController` that followed `selectedSessionId`,
 * so only one project-session turn could run at a time and stop/approval/queue
 * cross-wired to whichever session was viewed. Here every project session gets
 * its OWN pinned controller (fixed "personal" profile + sessionId + working
 * directory), so background turns keep streaming into their own transcript while
 * the user views another session, and stop/approval/queue always target the
 * turn's own session.
 *
 * This is a MODULE SINGLETON (`projectChatStore`) so a project turn survives
 * ProjectChat unmount/remount (switching projects or panes) — the runtime is
 * torn down only on service disconnect / host teardown (ChatView), matching the
 * main chat. The per-session transcript now lives in the registry entry, not
 * `projectsStore.messages`, so concurrent sessions stay independent.
 *
 * Reactivity rule (memory `desktop-controller-legacy-reactivity`): the legacy
 * `$:` ProjectChat template cannot track runes `$state` directly, so every value
 * it needs is projected through the single `state` store, whose getter tracks
 * the active entry's `$state` fields plus every entry's status dot.
 */

export interface ProjectChatStoreDeps {
  endpoint(): string;
  modelReady(): boolean;
  labels(): ConversationLabels;
  /** Refresh the selected project's session list (titles/order) after a turn. */
  refreshSessions?(): Promise<void>;
  /** Post-mutation hook (e.g. scroll to bottom). */
  afterMutate?(profileId: string, sessionId: string): void;
  /** Model key a turn on this session should run with (per-session override →
   *  project default → global default; owned by ProjectChat). */
  resolveModel(sessionId: string): string | undefined;
  /** Thinking level a turn on this session should run with. */
  resolveThinking(sessionId: string): DesktopThinkingLevel;
}

export interface ProjectChatState {
  activeSessionId: string;
  messages: UiMessage[];
  error: string;
  sending: boolean;
  streamingText: string;
  streamingThinking: string;
  activity: string;
  activities: DesktopActivityEntry[];
  pendingApproval: DesktopApprovalPrompt | null;
  queue: string[];
  statusDots: Map<string, SessionStatusDot>;
}

const PROJECT_PROFILE_ID = "personal";

function buildDots(entries: SessionRuntimeEntry[]): Map<string, SessionStatusDot> {
  const dots = new Map<string, SessionStatusDot>();
  for (const entry of entries) {
    const dot = entry.statusDot;
    if (dot) dots.set(entry.key, dot);
  }
  return dots;
}

export class ProjectChatStore {
  readonly draftStore = new SessionDraftStore();
  readonly registry = new SessionRuntimeRegistry(this.draftStore);

  /** The working-directory project id each session is pinned to, so a pinned
   *  controller resolves the right project for a background turn regardless of
   *  the currently-selected project. */
  private readonly sessionProjectIds = new Map<string, string>();
  private deps: ProjectChatStoreDeps | null = null;

  /**
   * Wires the host dependencies. Re-callable on every ProjectChat mount (the
   * singleton keeps its entries; init only refreshes the closures). The
   * registry's optional per-entry resolvers pin the working directory + model +
   * thinking level to each session, so the main chat's registry (which leaves
   * them unset) is unaffected.
   */
  init(deps: ProjectChatStoreDeps): void {
    this.deps = deps;
    const registryDeps: SessionRuntimeDeps = {
      // Existing registry entries survive component remounts. Resolve through
      // `this.deps` so they never retain stale closures from an old ProjectChat.
      endpoint: () => this.deps?.endpoint() ?? "",
      modelReady: () => this.deps?.modelReady() ?? false,
      labels: () => this.deps?.labels() ?? deps.labels(),
      loadTranscript: (profileId, sessionId) => this.loadTranscript(profileId, sessionId),
      refreshSessions: () => this.deps?.refreshSessions?.() ?? Promise.resolve(),
      afterMutate: (profileId, sessionId) => this.deps?.afterMutate?.(profileId, sessionId),
      projectId: (_profileId, sessionId) => this.sessionProjectIds.get(sessionId),
      modelKey: (_profileId, sessionId) => this.deps?.resolveModel(sessionId),
      thinkingLevel: (_profileId, sessionId) => this.deps?.resolveThinking(sessionId) ?? "medium"
    };
    this.registry.init(registryDeps);
  }

  /** Loads a project session transcript for the registry entry. The project id
   *  comes from the per-session map (not the current selection) so a background
   *  session reloads against its own project. Project messages carry the same
   *  shape as conversation messages aside from the wider `role` union, which the
   *  transcript renderer treats as an opaque string. */
  private async loadTranscript(_profileId: string, sessionId: string): Promise<UiMessage[]> {
    const endpoint = this.deps?.endpoint();
    if (!endpoint) return [];
    const projectId = this.sessionProjectIds.get(sessionId) ?? "";
    const messages = await loadDesktopProjectSession(endpoint, projectId, sessionId);
    return messages as unknown as UiMessage[];
  }

  /**
   * Single reactive snapshot for the legacy `$:` ProjectChat. Re-evaluates when
   * the active session changes, the active controller's turn state mutates, or
   * any entry's status dot changes (background runs).
   */
  readonly state = toStore<ProjectChatState>(() => {
    const entry = this.registry.active;
    const controller = entry?.controller;
    return {
      activeSessionId: entry?.sessionId ?? "",
      messages: entry?.messages ?? [],
      error: entry?.error ?? "",
      sending: controller?.sending ?? false,
      streamingText: controller?.streamingText ?? "",
      streamingThinking: controller?.streamingThinking ?? "",
      activity: controller?.activity ?? "",
      activities: controller?.activities ?? [],
      pendingApproval: controller?.pendingApproval ?? null,
      queue: controller?.queue ?? [],
      statusDots: buildDots(this.registry.list())
    };
  });

  /** Opens a project session: pins its working directory, ensures its
   *  controller, marks it active (clearing any terminal unread dot), and reloads
   *  its transcript. Switching never touches another entry's in-flight turn. */
  selectSession(sessionId: string, projectId: string): void {
    if (!sessionId || !this.deps) return;
    this.sessionProjectIds.set(sessionId, projectId);
    const entry = this.registry.getOrCreate(PROJECT_PROFILE_ID, sessionId);
    this.registry.setActive(PROJECT_PROFILE_ID, sessionId);
    void entry.reloadFromServer();
  }

  /** Sends a turn on a specific session through its pinned controller. */
  async send(sessionId: string, text: string, files: File[]): Promise<void> {
    const entry = this.registry.get(PROJECT_PROFILE_ID, sessionId);
    if (!entry) return;
    const content = text.trim();
    if (!content && files.length === 0) return;
    await entry.controller.send({ message: content, files });
  }

  /** Queues a follow-up against the active session's controller. */
  enqueueFollowUp(text: string): boolean {
    const controller = this.registry.active?.controller;
    if (!controller) return false;
    return controller.enqueue(text);
  }

  removeQueued(index: number): void {
    this.registry.active?.controller.removeQueued(index);
  }

  async stopActive(): Promise<void> {
    await this.registry.active?.controller.stop();
  }

  async resolveApproval(decision: DesktopApprovalDecision): Promise<void> {
    await this.registry.active?.controller.resolveApproval(decision);
  }

  /** Re-fetches the active session transcript; used to recover after an
   *  edit-truncate reports the picked message id wasn't on the server. */
  async reloadActive(): Promise<void> {
    await this.registry.active?.reloadFromServer();
  }

  /** Clears the active session's turn-error banner (dismiss button). */
  clearActiveError(): void {
    this.registry.active?.clearError();
  }

  /** Disposes a specific session's runtime (e.g. after it was deleted). */
  disposeSession(sessionId: string): void {
    this.registry.dispose(PROJECT_PROFILE_ID, sessionId);
    this.sessionProjectIds.delete(sessionId);
  }

  disposeAll(): void {
    this.registry.disposeAll();
    this.sessionProjectIds.clear();
  }
}

/** Module singleton so project turns survive ProjectChat unmount/remount. */
export const projectChatStore = new ProjectChatStore();
