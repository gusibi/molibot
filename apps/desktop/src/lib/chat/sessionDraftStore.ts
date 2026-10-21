import type { DesktopThinkingSelection } from "@molibot/desktop-contract";

/**
 * Per-session composer draft store (plan §10). Each session keeps its own
 * input text, pending attachments and thinking-level selection so switching
 * sessions never loses in-progress input, and switching back restores it.
 *
 * Pure (no runes): reactivity is provided by the host component reading the
 * draft into its own bound input on session switch. Drafts are in-memory only
 * (plan §10.3) — `File` objects cannot be safely persisted across restarts, so
 * a restarted app prompts the user to re-pick attachments rather than
 * restoring stale file handles.
 */

export const NEW_CONVERSATION_KEY = "__new_conversation__";

/** Draft key for an existing, persisted session. */
export function sessionDraftKey(profileId: string, sessionId: string): string {
  return `${profileId}:${sessionId}`;
}

/**
 * Draft key for an Agent's new conversation. The Agent id is carried explicitly
 * instead of being encoded into a pseudo profile string and parsed back.
 */
export function agentDraftKey(agentId: string): string {
  return `${NEW_CONVERSATION_KEY}:agent:${agentId}`;
}

/**
 * Draft key the live composer binds to right now: the active session's key, or
 * the current Agent’s new-conversation draft when no session is active. One rule, shared
 * by the store and the ChatView mirror, so the two can never disagree about
 * which draft the composer is currently editing.
 */
export function composerDraftKey(activeSessionId: string, activeProfileId: string): string {
  return activeSessionId ? sessionDraftKey(activeProfileId, activeSessionId) : activeProfileId ? `${NEW_CONVERSATION_KEY}:${activeProfileId}` : NEW_CONVERSATION_KEY;
}

export interface SessionDraft {
  text: string;
  files: File[];
  thinkingLevel: DesktopThinkingSelection;
  modelKey?: string;
  thinkingTouched?: boolean;
  permissionMode?: "plan" | "manual" | "accept_edits" | "auto";
  /**
   * Transport profile for a new-conversation draft. It never encodes the Agent.
   */
  profileId?: string;
  /**
   * Agent this draft will create its Session under. Explicit: the session's
   * ownership is never inferred from the profile id.
   */
  agentId?: string;
}

export function emptyDraft(thinkingLevel: DesktopThinkingSelection = "medium"): SessionDraft {
  return { text: "", files: [], thinkingLevel };
}

/**
 * Stores one draft per session key (existing sessions) plus one
 * new-conversation draft per Agent. Drafts stay out of persisted history until
 * the first message creates a Session.
 */
export class SessionDraftStore {
  private readonly drafts = new Map<string, SessionDraft>();
  private readonly defaultThinking: DesktopThinkingSelection;

  constructor(defaultThinking: DesktopThinkingSelection = "medium") {
    this.defaultThinking = defaultThinking;
  }

  /** Returns the draft for a key, creating an empty one on first access. */
  get(key: string): SessionDraft {
    const existing = this.drafts.get(key);
    if (existing) return existing;
    const draft = emptyDraft(this.defaultThinking);
    this.drafts.set(key, draft);
    return draft;
  }

  has(key: string): boolean {
    return this.drafts.has(key);
  }

  update(key: string, patch: Partial<SessionDraft>): SessionDraft {
    const current = this.get(key);
    const next = { ...current, ...patch };
    if (Object.entries(patch).every(([field, value]) => field === "files"
      ? current.files.length === next.files.length && current.files.every((file, index) => file === next.files[index])
      : current[field as keyof SessionDraft] === value)) return current;
    this.drafts.set(key, next);
    return next;
  }

  setText(key: string, text: string): void {
    this.update(key, { text });
  }

  setFiles(key: string, files: File[]): void {
    this.update(key, { files });
  }

  setThinking(key: string, level: DesktopThinkingSelection): void {
    this.update(key, { thinkingLevel: level });
  }

  /** Binds a new-conversation draft to the Agent that will own the Session. */
  setAgentTarget(key: string, agentId: string): void {
    this.update(key, { agentId });
  }

  /** Clears the composer draft after a turn is accepted, or on discard. */
  clear(key: string): void {
    this.drafts.delete(key);
  }

  clearAll(): void {
    this.drafts.clear();
  }
}
