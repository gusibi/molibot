import type { DesktopThinkingLevel } from "@molibot/desktop-contract";

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

export interface SessionDraft {
  text: string;
  files: File[];
  thinkingLevel: DesktopThinkingLevel;
  /**
   * Selected Bot for the new-conversation draft only (plan §6.1). Ignored for
   * existing sessions, whose Bot is fixed at first-message time (plan §6.3).
   */
  profileId?: string;
}

export function emptyDraft(thinkingLevel: DesktopThinkingLevel = "medium"): SessionDraft {
  return { text: "", files: [], thinkingLevel };
}

/**
 * Stores one draft per session key (existing sessions) plus a single
 * new-conversation draft (plan §10.2: only one not-yet-persisted draft at a
 * time, so the sidebar never shows multiple invisible temp sessions).
 */
export class SessionDraftStore {
  private readonly drafts = new Map<string, SessionDraft>();
  private readonly defaultThinking: DesktopThinkingLevel;

  constructor(defaultThinking: DesktopThinkingLevel = "medium") {
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
    this.drafts.set(key, next);
    return next;
  }

  setText(key: string, text: string): void {
    this.update(key, { text });
  }

  setFiles(key: string, files: File[]): void {
    this.update(key, { files });
  }

  setThinking(key: string, level: DesktopThinkingLevel): void {
    this.update(key, { thinkingLevel: level });
  }

  setProfileId(key: string, profileId: string): void {
    this.update(key, { profileId });
  }

  /** Clears the composer draft after a turn is accepted, or on discard. */
  clear(key: string): void {
    this.drafts.delete(key);
  }

  clearAll(): void {
    this.drafts.clear();
  }
}
