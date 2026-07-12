import { toStore } from "svelte/store";
import type { Readable } from "svelte/store";
import {
  addToFollowUpQueue,
  nextFollowUp,
  resolveDesktopHostBash,
  stopDesktopChat,
  type DesktopActivityEntry
} from "../api";
import { runDesktopConversationTurn } from "./conversationTurn";
import type {
  DesktopApprovalDecision,
  DesktopApprovalPrompt,
  DesktopConversationMessage,
  DesktopThinkingLevel
} from "@molibot/desktop-contract";

/** A transcript message plus the optional collapsed reasoning trace. */
export type UiMessage = DesktopConversationMessage & { thinking?: string };

/** Immutable snapshot of the controller's live turn state (see `view`). */
export interface ConversationView {
  sending: boolean;
  streamingText: string;
  streamingThinking: string;
  activity: string;
  activities: DesktopActivityEntry[];
  pendingApproval: DesktopApprovalPrompt | null;
  queue: string[];
}

/** Localized status strings surfaced by the controller as a turn progresses. */
export interface ConversationLabels {
  working: string;
  uploading: string;
  stopped: string;
  idle: string;
  resuming: string;
}

/**
 * The host adapter. Each surface (main chat, project chat) owns its own
 * transcript/error state and composer chrome; the controller drives the shared
 * send/stream/queue/approval logic through these hooks so there is a single
 * turn implementation across the app.
 */
export interface ConversationHost {
  endpoint(): string;
  profileId(): string;
  sessionId(): string;
  projectId?(): string | undefined;
  thinkingLevel(): DesktopThinkingLevel;
  /** Guard for readiness (e.g. a configured model); a turn is skipped when false. */
  canSend?(): boolean;
  labels(): ConversationLabels;
  /** Current transcript roles, used to detect the resumed answer after an approval. */
  getMessages(): ReadonlyArray<{ role: string }>;
  /** Optimistically append the outgoing user message to the host transcript. */
  appendUserMessage(content: string, files: File[]): void;
  /** Re-fetch the session transcript into the host after a turn settles. */
  reload(sessionId: string): Promise<void>;
  /** Refresh the session list (titles/order) after a turn. */
  refreshSessions?(): Promise<void>;
  /** Clear the composer input/attachments once a turn is accepted. */
  clearComposer?(): void;
  /** Post-mutation hook, e.g. scroll to bottom. */
  afterMutate?(): void;
  setError(message: string): void;
  clearError(): void;
}

/**
 * Owns the transient state of a conversation turn and the orchestration shared
 * by every chat surface. Reactive fields are read directly by the host template
 * (`controller.sending`, `controller.streamingText`, …); the host owns the
 * durable transcript and error banner.
 */
export class ConversationController {
  sending = $state(false);
  streamingText = $state("");
  streamingThinking = $state("");
  activity = $state("");
  activities = $state<DesktopActivityEntry[]>([]);
  pendingApproval = $state<DesktopApprovalPrompt | null>(null);
  queue = $state<string[]>([]);

  /**
   * A store snapshot of the live turn state. Host surfaces run in legacy mode
   * (`export let` + `$:`), whose reactivity is compile-time: a `$:` only re-runs
   * when a referenced top-level `let` is reassigned. Reading `controller.foo`
   * there never re-runs, because the controller reference is stable and the
   * `$state` fields mutate through Svelte's signal graph, invisible to the
   * legacy tracker. Exposing the state as a store lets those components
   * auto-subscribe with `$view` and stay reactive while a turn streams.
   */
  readonly view: Readable<ConversationView> = toStore(() => ({
    sending: this.sending,
    streamingText: this.streamingText,
    streamingThinking: this.streamingThinking,
    activity: this.activity,
    activities: this.activities,
    pendingApproval: this.pendingApproval,
    queue: this.queue
  }));

  private abort: AbortController | null = null;

  constructor(private readonly host: ConversationHost) {}

  /** Reset streaming/approval scratch state when switching sessions. */
  clearTurn(): void {
    this.streamingText = "";
    this.streamingThinking = "";
    this.activities = [];
    this.pendingApproval = null;
  }

  clearQueue(): void {
    this.queue = [];
  }

  /** Abort any in-flight turn; call from the host's onDestroy. */
  dispose(): void {
    this.abort?.abort();
    this.abort = null;
  }

  /** Queue a follow-up while a turn is in flight. Returns true when accepted. */
  enqueue(text: string): boolean {
    const next = addToFollowUpQueue(this.queue, text);
    if (next === this.queue) return false;
    this.queue = next;
    return true;
  }

  removeQueued(index: number): void {
    this.queue = this.queue.filter((_, position) => position !== index);
  }

  private drainQueue(): void {
    if (this.sending || this.queue.length === 0) return;
    const { next, rest } = nextFollowUp(this.queue);
    this.queue = rest;
    if (next) void this.send({ message: next });
  }

  async send({ message, files = [] }: { message: string; files?: File[] }): Promise<void> {
    const content = message.trim();
    const hasFiles = files.length > 0;
    const endpoint = this.host.endpoint();
    const sessionId = this.host.sessionId();
    if (!endpoint || !sessionId || this.sending) return;
    if (this.host.canSend && !this.host.canSend()) return;
    if (!content && !hasFiles) return;

    const labels = this.host.labels();
    this.sending = true;
    this.host.clearError();
    this.activity = hasFiles ? labels.uploading : labels.working;
    this.streamingText = "";
    this.streamingThinking = "";
    this.activities = [];
    this.pendingApproval = null;
    this.host.clearComposer?.();
    this.host.appendUserMessage(content, files);
    this.host.afterMutate?.();

    this.abort = new AbortController();
    try {
      await runDesktopConversationTurn({
        endpoint,
        profileId: this.host.profileId(),
        sessionId,
        projectId: this.host.projectId?.(),
        message: content,
        thinkingLevel: this.host.thinkingLevel(),
        files: hasFiles ? files : undefined,
        signal: this.abort.signal
      }, hasFiles ? {} : {
        onToken: (delta) => (this.streamingText += delta),
        onReplace: (text) => (this.streamingText = text),
        onThinking: (delta) => (this.streamingThinking += delta),
        onStatus: (text) => { if (text) this.activity = text; },
        onActivities: (next) => (this.activities = next),
        onApproval: (approval) => (this.pendingApproval = approval),
        onDone: (done) => {
          this.streamingText = done.response || this.streamingText;
          this.streamingThinking = done.thinkingText || this.streamingThinking;
        }
      });
      await this.host.refreshSessions?.();
      await this.host.reload(sessionId);
      this.streamingText = "";
      this.streamingThinking = "";
      this.activity = "";
      this.host.afterMutate?.();
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        this.host.setError(cause instanceof Error ? cause.message : String(cause));
      }
      await this.host.reload(sessionId).catch(() => undefined);
    } finally {
      this.sending = false;
      this.abort = null;
    }
    this.drainQueue();
  }

  async stop(): Promise<void> {
    const endpoint = this.host.endpoint();
    const sessionId = this.host.sessionId();
    if (!endpoint || !sessionId || !this.sending) return;
    const labels = this.host.labels();
    this.queue = [];
    this.abort?.abort();
    try {
      const stopped = await stopDesktopChat(endpoint, this.host.profileId(), sessionId);
      this.activity = stopped ? labels.stopped : labels.idle;
    } catch (cause) {
      this.host.setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async resolveApproval(decision: DesktopApprovalDecision): Promise<void> {
    const endpoint = this.host.endpoint();
    if (!endpoint || !this.pendingApproval) return;
    const labels = this.host.labels();
    const requestId = this.pendingApproval.requestId;
    const sessionId = this.host.sessionId();
    this.pendingApproval = null;
    this.host.clearError();
    this.activity = labels.resuming;

    if (this.sending) {
      // The SSE stream from send() is still active. Just send the decision so
      // the server can continue the run; the live stream will pick up the
      // resumed output and send() will handle reload/cleanup when it ends.
      try {
        await resolveDesktopHostBash(endpoint, this.host.profileId(), sessionId, requestId, decision);
      } catch (cause) {
        this.host.setError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }

    // Offline path: the SSE stream already ended before the user acted.
    // Drive the approval → poll cycle ourselves.
    this.sending = true;
    try {
      await resolveDesktopHostBash(endpoint, this.host.profileId(), sessionId, requestId, decision);
      // The approved command runs and the original turn resumes in the background,
      // appending its answer asynchronously; poll the transcript until it lands.
      const before = this.host.getMessages().filter((message) => message.role === "assistant").length;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (sessionId !== this.host.sessionId()) return;
        await this.host.reload(sessionId);
        const after = this.host.getMessages().filter((message) => message.role === "assistant").length;
        if (decision === "reject" || after > before) break;
      }
      await this.host.refreshSessions?.();
    } catch (cause) {
      this.host.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this.sending = false;
      this.activity = "";
    }
  }
}

export function createConversationController(host: ConversationHost): ConversationController {
  return new ConversationController(host);
}
