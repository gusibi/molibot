import { SvelteMap } from "svelte/reactivity";
import {
  createConversationController,
  ConversationController,
  type ConversationHost,
  type ConversationLabels,
  type UiMessage
} from "./conversationController.svelte";
import { SessionDraftStore, sessionDraftKey } from "./sessionDraftStore";
import {
  deriveStatusDot,
  nextTurnStatus,
  sessionRuntimeKey,
  type SessionRunStatus,
  type SessionRuntimeKey,
  type SessionStatusDot
} from "./sessionStatusDot";
import type { DesktopMessageAttachment, DesktopThinkingLevel } from "@molibot/desktop-contract";

/**
 * Per-session runtime registry (plan §7.3 / §13). Replaces the old single
 * `ConversationController` that followed whichever session was "active": here
 * every session gets its OWN controller PINNED to a fixed profileId/sessionId,
 * so a background turn keeps streaming into its own state while the user views
 * another session. Switching sessions only changes which entry the view binds
 * to - it never repoints or disposes a running controller (plan §7.1 / §7.4).
 *
 * Each entry also owns its transcript + error + status dot + draft, so the
 * pinned controller's host adapter is self-contained and never reads mutable
 * "active" state (the bug that cross-wired sessions in the old single-controller
 * design).
 */

export interface SessionRuntimeDeps {
  endpoint(): string;
  modelReady(): boolean;
  labels(): ConversationLabels;
  /** Re-fetches a session's transcript as `UiMessage[]` (host owns the mapping). */
  loadTranscript(profileId: string, sessionId: string): Promise<UiMessage[]>;
  refreshSessions?(): Promise<void>;
  afterMutate?(profileId: string, sessionId: string): void;
  /**
   * Optional per-entry resolvers injected by surfaces that pin extra turn
   * context to a session (project chat: a working directory + per-session
   * model/thinking overrides). The main chat leaves these unset, so its pinned
   * host keeps `projectId`/`modelKey` undefined and reads thinking from the
   * draft store exactly as before (callers inject differences, no fork).
   */
  projectId?(profileId: string, sessionId: string): string | undefined;
  modelKey?(profileId: string, sessionId: string): string | undefined;
  thinkingLevel?(profileId: string, sessionId: string): DesktopThinkingLevel;
}

export interface SessionRuntimeEntry {
  readonly key: SessionRuntimeKey;
  readonly profileId: string;
  readonly sessionId: string;
  readonly controller: ConversationController;
  readonly messages: UiMessage[];
  readonly error: string;
  readonly status: SessionRunStatus;
  readonly lastRunId: string | undefined;
  readonly isActive: boolean;
  readonly statusDot: SessionStatusDot | null;
  appendUser(content: string, files: File[]): void;
  reloadFromServer(): Promise<void>;
  setError(message: string): void;
  clearError(): void;
  dispose(): void;
}

function inferAttachmentKind(file: File): DesktopMessageAttachment["mediaType"] {
  const type = file.type.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "file";
}

class SessionRuntimeEntryImpl implements SessionRuntimeEntry {
  readonly key: SessionRuntimeKey;
  readonly profileId: string;
  readonly sessionId: string;
  readonly controller: ConversationController;

  messages = $state<UiMessage[]>([]);
  error = $state("");
  status = $state<SessionRunStatus>("idle");
  lastRunId = $state<string | undefined>(undefined);
  isActive = $state(false);

  private prevSending = false;
  private readonly unsubscribe: () => void;
  private readonly deps: SessionRuntimeDeps;
  private readonly draftStore: SessionDraftStore;

  constructor(
    profileId: string,
    sessionId: string,
    deps: SessionRuntimeDeps,
    draftStore: SessionDraftStore
  ) {
    this.profileId = profileId;
    this.sessionId = sessionId;
    this.key = sessionRuntimeKey(profileId, sessionId);
    this.deps = deps;
    this.draftStore = draftStore;

    // Pinned host adapter: profileId/sessionId are captured once and never
    // follow "active" state, so a turn started here always writes back here.
    const self = this;
    const host: ConversationHost = {
      endpoint: () => deps.endpoint(),
      profileId: () => profileId,
      sessionId: () => sessionId,
      projectId: deps.projectId ? () => deps.projectId!(profileId, sessionId) : undefined,
      modelKey: deps.modelKey ? () => deps.modelKey!(profileId, sessionId) : undefined,
      thinkingLevel: () =>
        deps.thinkingLevel?.(profileId, sessionId) ??
        draftStore.get(sessionDraftKey(profileId, sessionId)).thinkingLevel,
      canSend: () => Boolean(profileId) && Boolean(sessionId) && deps.modelReady(),
      labels: () => deps.labels(),
      getMessages: () => self.messages,
      appendUserMessage: (content, files) => self.appendUser(content, files),
      reload: () => self.reloadFromServer(),
      refreshSessions: () => deps.refreshSessions?.() ?? Promise.resolve(),
      clearComposer: () => draftStore.clear(sessionDraftKey(profileId, sessionId)),
      afterMutate: () => deps.afterMutate?.(profileId, sessionId),
      setError: (message) => self.setError(message),
      clearError: () => self.clearError()
    };
    this.controller = createConversationController(host);

    // Track turn transitions to drive the status dot. The controller's `view`
    // store re-emits on any live-state change; we only act on sending edges.
    this.unsubscribe = this.controller.view.subscribe((view) => {
      const next = nextTurnStatus({
        prevSending: this.prevSending,
        sending: view.sending,
        pendingApproval: Boolean(view.pendingApproval),
        isActive: this.isActive,
        error: this.error,
        current: this.status
      });
      this.prevSending = view.sending;
      if (next !== this.status) this.status = next;
    });
  }

  get statusDot(): SessionStatusDot | null {
    return deriveStatusDot(this.status, this.isActive);
  }

  appendUser(content: string, files: File[]): void {
    this.messages = [
      ...this.messages,
      {
        id: `pending-${Date.now()}`,
        conversationId: this.sessionId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        attachments:
          files.length > 0
            ? files.map((file) => ({
                original: file.name,
                local: "",
                mediaType: inferAttachmentKind(file),
                mimeType: file.type || undefined,
                size: file.size
              }))
            : undefined
      }
    ];
  }

  async reloadFromServer(): Promise<void> {
    try {
      const messages = await this.deps.loadTranscript(this.profileId, this.sessionId);
      this.messages = messages;
    } catch {
      // Leave the existing transcript in place on reload failure.
    }
  }

  setError(message: string): void {
    this.error = message;
  }

  clearError(): void {
    this.error = "";
  }

  dispose(): void {
    this.unsubscribe();
    this.controller.dispose();
  }
}

export class SessionRuntimeRegistry {
  private readonly entries = new SvelteMap<SessionRuntimeKey, SessionRuntimeEntryImpl>();
  private activeKey = $state<SessionRuntimeKey | null>(null);
  private deps: SessionRuntimeDeps | null = null;

  constructor(private readonly draftStore: SessionDraftStore) {}

  /** Provides the host dependencies used to construct pinned controllers. */
  init(deps: SessionRuntimeDeps): void {
    this.deps = deps;
  }

  get(profileId: string, sessionId: string): SessionRuntimeEntry | undefined {
    return this.entries.get(sessionRuntimeKey(profileId, sessionId));
  }

  /**
   * Returns the entry for a session, creating a pinned controller on first
   * access. Creating an entry never aborts or disposes any other entry's
   * in-flight turn (plan §7.1).
   */
  getOrCreate(profileId: string, sessionId: string): SessionRuntimeEntry {
    if (!this.deps) throw new Error("SessionRuntimeRegistry.init must be called before use.");
    const key = sessionRuntimeKey(profileId, sessionId);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const entry = new SessionRuntimeEntryImpl(profileId, sessionId, this.deps, this.draftStore);
    this.entries.set(key, entry);
    return entry;
  }

  /** Returns the currently-viewed entry, if any. */
  get active(): SessionRuntimeEntry | undefined {
    return this.activeKey ? this.entries.get(this.activeKey) : undefined;
  }

  /** Snapshot of every entry, for sidebar status-dot derivation. */
  list(): SessionRuntimeEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Marks a session as the one the user is viewing. A background session whose
   * run just completed/failed is considered "read" the moment it becomes active
   * - its terminal status is cleared so no unread dot lingers (plan §8.2).
   * Viewing a running/waiting session leaves its live status intact.
   */
  setActive(profileId: string, sessionId: string): void {
    const key = sessionRuntimeKey(profileId, sessionId);
    for (const [existingKey, entry] of this.entries) {
      const becomesActive = existingKey === key;
      entry.isActive = becomesActive;
      if (becomesActive && (entry.status === "completed" || entry.status === "failed")) {
        entry.clearError();
        entry.status = "idle";
      }
    }
    this.activeKey = key;
  }

  clearActive(): void {
    for (const entry of this.entries.values()) entry.isActive = false;
    this.activeKey = null;
  }

  dispose(profileId: string, sessionId: string): void {
    const key = sessionRuntimeKey(profileId, sessionId);
    const entry = this.entries.get(key);
    if (!entry) return;
    // The plan (§7.3) requires a session not be disposed while it has an active
    // run; callers must stop it first. We dispose defensively regardless.
    entry.dispose();
    this.entries.delete(key);
    if (this.activeKey === key) this.activeKey = null;
  }

  disposeAll(): void {
    for (const entry of this.entries.values()) entry.dispose();
    this.entries.clear();
    this.activeKey = null;
  }
}
