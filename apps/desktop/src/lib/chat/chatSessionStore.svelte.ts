import { toStore } from "svelte/store";
import {
  SessionRuntimeRegistry,
  type SessionRuntimeDeps,
  type SessionRuntimeEntry
} from "./sessionRuntimeRegistry.svelte";
import {
  SessionDraftStore,
  NEW_CONVERSATION_KEY,
  sessionDraftKey
} from "./sessionDraftStore";
import type { ConversationLabels, UiMessage } from "./conversationController.svelte";
import type { SessionStatusDot } from "./sessionStatusDot";
import type {
  DesktopApprovalDecision,
  DesktopApprovalPrompt,
  DesktopSessionRun
} from "@molibot/desktop-contract";
import {
  createDesktopSession,
  listDesktopSessionRuns,
  loadDesktopSession,
  stopDesktopChat,
  type DesktopActivityEntry
} from "../api";

/**
 * The chat session store (plan §4 / §5). Owns the per-session runtime registry
 * plus the "active session" the right pane is bound to, and bridges the active
 * entry's live turn state into a single Svelte store (`state`) so the legacy
 * `$:` ChatView can subscribe (`$chatStore.state`) exactly the way it used to
 * subscribe to a single controller's `view` store. The registry — not this
 * store — is the source of truth for per-session transcript/error/status; this
 * store only projects the active entry plus sidebar status dots and exposes the
 * high-level actions (select / new draft / send / stop / resolveApproval /
 * reconnect).
 *
 * Reactivity rule (plan §5 / memory `desktop-controller-legacy-reactivity`):
 * legacy `$:` cannot track runes `$state` directly, so every value the legacy
 * template needs is exposed through the `state` store, whose getter tracks the
 * active entry's `$state` fields, the active-key signal, the draft flags, AND
 * every entry's status dot (so background status changes refresh the sidebar).
 */

export interface ChatSessionStoreDeps {
  endpoint(): string;
  modelReady(): boolean;
  labels(): ConversationLabels;
  /** Loads a session transcript as `UiMessage[]` (host owns role filtering). */
  loadTranscript(profileId: string, sessionId: string): Promise<UiMessage[]>;
  /** Re-fetch the sidebar's expanded-channel list after a turn/session change. */
  refreshSidebar?(): Promise<void>;
  /** Post-mutation hook (e.g. scroll to bottom). */
  afterMutate?(profileId: string, sessionId: string): void;
  /** Notifies the host that a brand-new session was just created (so it can
   * refresh the sidebar / write the last-bot preference). */
  onSessionCreated?(profileId: string, sessionId: string): void;
}

export interface ChatSessionState {
  activeSessionId: string;
  activeProfileId: string;
  draftMode: boolean;
  draftProfileId: string;
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

function buildDots(entries: SessionRuntimeEntry[]): Map<string, SessionStatusDot> {
  const dots = new Map<string, SessionStatusDot>();
  for (const entry of entries) {
    const dot = entry.statusDot;
    if (dot) dots.set(entry.key, dot);
  }
  return dots;
}

export class ChatSessionStore {
  readonly draftStore = new SessionDraftStore();
  readonly registry = new SessionRuntimeRegistry(this.draftStore);

  /** True when the right pane shows the not-yet-persisted new-conversation draft. */
  draftMode = $state(false);
  /** Bot (profile id) chosen for the new-conversation draft (plan §6.1). */
  draftProfileId = $state("");

  private deps: ChatSessionStoreDeps | null = null;

  init(deps: ChatSessionStoreDeps): void {
    this.deps = deps;
    const registryDeps: SessionRuntimeDeps = {
      endpoint: () => deps.endpoint(),
      modelReady: () => deps.modelReady(),
      labels: () => deps.labels(),
      loadTranscript: (profileId, sessionId) => deps.loadTranscript(profileId, sessionId),
      refreshSessions: () => deps.refreshSidebar?.() ?? Promise.resolve(),
      afterMutate: (profileId, sessionId) => deps.afterMutate?.(profileId, sessionId)
    };
    this.registry.init(registryDeps);
  }

  /**
   * Single reactive snapshot for the legacy `$:` ChatView. Re-evaluates when the
   * active session changes, the active controller's turn state mutates, the
   * draft flags change, or any entry's status dot changes (background runs).
   */
  readonly state = toStore<ChatSessionState>(() => {
    const entry = this.registry.active;
    const controller = entry?.controller;
    return {
      activeSessionId: entry?.sessionId ?? "",
      activeProfileId: entry?.profileId ?? (this.draftMode ? this.draftProfileId : ""),
      draftMode: this.draftMode,
      draftProfileId: this.draftProfileId,
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

  /** Opens an existing session: ensures its pinned controller, marks it active
   * (clearing any background terminal unread dot for it), and reloads its
   * transcript. Switching never touches any other entry's in-flight turn. */
  selectSession(profileId: string, sessionId: string): void {
    if (!profileId || !sessionId) return;
    this.draftMode = false;
    const entry = this.registry.getOrCreate(profileId, sessionId);
    this.registry.setActive(profileId, sessionId);
    void entry.reloadFromServer();
  }

  /** Enters the not-yet-persisted new-conversation draft (plan §6.1). */
  newConversationDraft(defaultProfileId: string): void {
    this.registry.clearActive();
    this.draftMode = true;
    this.draftProfileId = defaultProfileId;
    this.draftStore.setProfileId(NEW_CONVERSATION_KEY, defaultProfileId);
  }

  /** Clears selection without creating an unsaved draft. */
  clearSelection(): void {
    this.registry.clearActive();
    this.draftMode = false;
    this.draftProfileId = "";
  }

  setDraftProfileId(profileId: string): void {
    this.draftProfileId = profileId;
    this.draftStore.setProfileId(NEW_CONVERSATION_KEY, profileId);
  }

  /**
   * Sends a turn. In draft mode the first message creates the session (plan
   * §6.1): createDesktopSession → registry.getOrCreate → setActive → send. For
   * an existing session the pinned controller handles it. The composer text/
   * files are passed in explicitly by the host; the new-conversation draft is
   * cleared here once the session exists.
   */
  async send(text: string, files: File[]): Promise<void> {
    const deps = this.deps;
    if (!deps) return;
    const endpoint = deps.endpoint();
    if (!endpoint) return;
    const content = text.trim();
    if (!content && files.length === 0) return;

    if (this.draftMode || !this.registry.active) {
      const profileId = this.draftProfileId;
      if (!profileId) return;
      const created = await createDesktopSession(endpoint, profileId);
      const entry = this.registry.getOrCreate(profileId, created.id);
      this.registry.setActive(profileId, created.id);
      this.draftMode = false;
      this.draftStore.clear(NEW_CONVERSATION_KEY);
      await entry.controller.send({ message: content, files });
      deps.onSessionCreated?.(profileId, created.id);
      return;
    }
    await this.registry.active.controller.send({ message: content, files });
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

  /** Clears the active session's turn-error banner (dismiss button). */
  clearActiveError(): void {
    this.registry.active?.clearError();
  }

  async resolveApproval(decision: DesktopApprovalDecision): Promise<void> {
    await this.registry.active?.controller.resolveApproval(decision);
  }

  /** Draft key the composer should be bound to right now. */
  currentDraftKey(): string {
    const active = this.registry.active;
    return active ? sessionDraftKey(active.profileId, active.sessionId) : NEW_CONVERSATION_KEY;
  }

  /** Disposes a specific session's runtime (e.g. after it was deleted). */
  disposeSession(profileId: string, sessionId: string): void {
    this.registry.dispose(profileId, sessionId);
  }

  /**
   * Reconnect recovery (plan §11). A crashed/disconnected Desktop can't resume
   * the dead SSE stream of a server-side run, so an orphaned run's live output
   * is unreachable - and the server keeps the session locked (the next send is
   * rejected as "Already working"). Rather than restore a phantom "running"
   * dot and leave the session blocked, abort each orphaned run server-side so
   * the user can start a new turn. Runs this Desktop is actively driving (a live
   * client turn) are left alone. Returns the count of aborted orphaned runs.
   */
  async reconnect(): Promise<number> {
    const deps = this.deps;
    if (!deps) return 0;
    const endpoint = deps.endpoint();
    if (!endpoint) return 0;
    let runs: DesktopSessionRun[] = [];
    try {
      const res = await listDesktopSessionRuns(endpoint);
      runs = res.runs;
    } catch {
      return 0;
    }
    let aborted = 0;
    for (const run of runs) {
      if (!run.profileId || !run.sessionId) continue;
      const existing = this.registry.get(run.profileId, run.sessionId);
      if (existing?.controller.sending) continue;
      try {
        await stopDesktopChat(endpoint, run.profileId, run.sessionId);
        aborted += 1;
      } catch {
        // Leave it; the next poll retries the abort.
      }
    }
    return aborted;
  }

  disposeAll(): void {
    this.registry.disposeAll();
    this.draftMode = false;
    this.draftProfileId = "";
  }
}
