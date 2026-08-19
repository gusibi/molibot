import { toStore } from "svelte/store";
import type { Readable } from "svelte/store";
import {
  addToFollowUpQueue,
  loadDesktopPendingApprovals,
  nextFollowUp,
  resolveDesktopHostBash,
  steerDesktopChat,
  stopDesktopChat,
  type DesktopActivityEntry
} from "../api";
import { runDesktopConversationTurn } from "./conversationTurn";
import { isAbortCause } from "./turnAbort";
import type {
  DesktopApprovalDecision,
  DesktopApprovalPrompt,
  DesktopApprovalResult,
  DesktopConversationMessage,
  DesktopConversationPlan,
  DesktopConversationStep,
  DesktopThinkingLevel
} from "@molibot/desktop-contract";

/** A transcript message plus the optional collapsed reasoning trace. */
export type UiMessage = DesktopConversationMessage & { thinking?: string };

/**
 * How long Stop waits for the server's stop endpoint before detaching the
 * stream locally. Bounded because the endpoint can itself be wedged by the
 * stuck run Stop is trying to end - an unbounded wait froze the button.
 */
const STOP_SERVER_WINDOW_MS = 5_000;

/** Immutable snapshot of the controller's live turn state (see `view`). */
export interface ConversationView {
  sending: boolean;
  streamingText: string;
  streamingThinking: string;
  activity: string;
  activities: DesktopActivityEntry[];
  liveSteps: DesktopConversationStep[];
  pendingApproval: DesktopApprovalPrompt | null;
  pendingApprovals: DesktopApprovalPrompt[];
  queue: string[];
  /**
   * The session that owns the current/last turn. Hosts whose sessionId is
   * mutable (e.g. project chat, where one controller follows the selection)
   * must gate the live streaming UI on `turnSessionId === selectedSessionId`,
   * otherwise a background turn bleeds into every session the user opens.
   */
  turnSessionId: string;
}

/** Localized status strings surfaced by the controller as a turn progresses. */
export interface ConversationLabels {
  working: string;
  uploading: string;
  recognizingImage: string;
  stopped: string;
  idle: string;
  resuming: string;
  /** Shown when the approval resolved but the host command itself failed. */
  approvalFailed?: string;
  /** Shown when the pending approval expired or was already handled. */
  approvalNotFound?: string;
  /** Shown when a transcript reload failed (the pane keeps the last messages). */
  transcriptLoadFailed?: string;
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
  modelKey?(): string | undefined;
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
  /** Monotonic ownership token used to reject transcript loads that overlap a newer turn. */
  turnSequence = $state(0);
  streamingText = $state("");
  streamingThinking = $state("");
  activity = $state("");
  activities = $state<DesktopActivityEntry[]>([]);
  liveSteps = $state<DesktopConversationStep[]>([]);
  pendingApprovals = $state<DesktopApprovalPrompt[]>([]);
  pendingApproval = $derived(this.pendingApprovals[0] ?? null);
  queue = $state<string[]>([]);
  turnSessionId = $state("");

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
    liveSteps: this.liveSteps,
    pendingApproval: this.pendingApproval,
    pendingApprovals: this.pendingApprovals,
    queue: this.queue,
    turnSessionId: this.turnSessionId
  }));

  private abort: AbortController | null = null;
  /** Set by stop() so the resulting stream rejection is not reported as a turn error. */
  private stopRequested = false;
  /** True while stop() is unwinding the turn; it owns the queue drain in that window. */
  private stopInFlight = false;

  /**
   * Streaming deltas are buffered here and flushed to the reactive fields at
   * most once per animation frame. Without this, every SSE token mutates
   * `streamingText`, which re-renders the whole `{@html}` bubble per token —
   * the transcript visibly "refreshes" and long replies saturate the main
   * thread. Plain fields on purpose: buffering must not be reactive.
   */
  private pendingLiveChunks: Array<{ kind: "text" | "thinking"; content: string }> = [];
  private nextLiveStep = 0;
  private streamFlushHandle: number | null = null;

  private scheduleStreamFlush(): void {
    if (this.streamFlushHandle !== null) return;
    // Node test environments have no requestAnimationFrame.
    if (typeof requestAnimationFrame === "function") {
      this.streamFlushHandle = requestAnimationFrame(() => {
        this.streamFlushHandle = null;
        this.flushStreamBuffers();
      });
    } else {
      this.streamFlushHandle = setTimeout(() => {
        this.streamFlushHandle = null;
        this.flushStreamBuffers();
      }, 16) as unknown as number;
    }
  }

  private cancelStreamFlush(): void {
    if (this.streamFlushHandle === null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.streamFlushHandle);
    else clearTimeout(this.streamFlushHandle);
    this.streamFlushHandle = null;
  }

  private flushStreamBuffers(): void {
    this.cancelStreamFlush();
    const chunks = this.pendingLiveChunks;
    this.pendingLiveChunks = [];
    for (const chunk of chunks) {
      this.appendLiveText(chunk.kind, chunk.content);
      if (chunk.kind === "text") this.streamingText += chunk.content;
      else this.streamingThinking += chunk.content;
    }
  }

  private bufferLiveText(kind: "text" | "thinking", delta: string): void {
    if (!delta) return;
    const previous = this.pendingLiveChunks.at(-1);
    if (previous?.kind === kind) previous.content += delta;
    else this.pendingLiveChunks.push({ kind, content: delta });
    this.scheduleStreamFlush();
  }

  private appendLiveText(kind: "text" | "thinking", delta: string): void {
    if (!delta) return;
    const previous = this.liveSteps.at(-1);
    if (previous?.kind === kind) {
      this.liveSteps = [...this.liveSteps.slice(0, -1), { ...previous, content: previous.content + delta }];
      return;
    }
    this.liveSteps = [...this.liveSteps, { id: `live-${++this.nextLiveStep}`, kind, content: delta }];
  }

  private upsertLiveActivity(activity: DesktopActivityEntry): void {
    // Tool events are ordering boundaries. Flush preceding model output before
    // inserting a new activity; otherwise the synchronous activity can overtake
    // thinking/text still waiting for the next animation frame.
    this.flushStreamBuffers();
    const index = this.liveSteps.findIndex((step) => step.kind === "activity" && step.activity.key === activity.key);
    if (index < 0) {
      this.liveSteps = [...this.liveSteps, { id: `live-${++this.nextLiveStep}`, kind: "activity", activity }];
      return;
    }
    this.liveSteps = this.liveSteps.map((step, position) => position === index && step.kind === "activity" ? { ...step, activity } : step);
  }

  private appendLivePlan(plan: DesktopConversationPlan): void {
    this.flushStreamBuffers();
    this.liveSteps = [...this.liveSteps, { id: `live-${++this.nextLiveStep}`, kind: "plan", plan }];
  }

  /**
   * A settled turn cannot have anything still "running". The stream can end
   * without per-activity terminal frames (aborted delegation, dropped events,
   * idle-timeout recovery), and the server's terminal-activity frames are
   * best-effort - this is the client-side half of the same contract. Without
   * it a leftover running card spins forever under a finished answer.
   */
  private settleRunningActivities(): void {
    const stepsPending = this.liveSteps.some((step) => step.kind === "activity" && step.activity.state === "running");
    const entriesPending = this.activities.some((entry) => entry.state === "running");
    if (!stepsPending && !entriesPending) return;
    if (stepsPending) {
      this.liveSteps = this.liveSteps.map((step) =>
        step.kind === "activity" && step.activity.state === "running"
          ? { ...step, activity: { ...step.activity, state: "error" as const } }
          : step
      );
    }
    if (entriesPending) {
      this.activities = this.activities.map((entry) =>
        entry.state === "running" ? { ...entry, state: "error" as const } : entry
      );
    }
  }

  /** Drop buffered deltas so a stale flush can't land on a later turn/session. */
  private resetStreamBuffers(): void {
    this.cancelStreamFlush();
    this.pendingLiveChunks = [];
  }

  /**
   * Full turn context pinned at send() start. A queued follow-up (drainQueue
   * passes a sessionId override) reuses this snapshot instead of re-reading the
   * host, so switching project / session / model before the queue drains can't
   * submit the pinned session under a different project or model. On surfaces
   * whose host is already pinned per session (the main chat registry) this is a
   * no-op — the host returns the same values either way.
   */
  private turnContext: {
    profileId: string;
    projectId: string | undefined;
    modelKey: string | undefined;
    thinkingLevel: DesktopThinkingLevel;
  } | null = null;

  constructor(private readonly host: ConversationHost) {}

  /** Reset streaming/approval scratch state when switching sessions. */
  clearTurn(): void {
    this.resetStreamBuffers();
    this.streamingText = "";
    this.streamingThinking = "";
    this.activities = [];
    this.liveSteps = [];
    this.pendingApprovals = [];
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

  /**
   * Steer: hand a queued message to the turn that is already running instead of
   * waiting for it to finish. The server injects it into the live agent loop
   * (the same Runner capability the chat channels expose as `/steer`), so the
   * answer takes it into account mid-run. When the run has already ended the
   * message stays queued and drains through the normal path.
   */
  async steerQueued(index: number): Promise<boolean> {
    const text = this.queue[index];
    const endpoint = this.host.endpoint();
    const sessionId = this.turnSessionId || this.host.sessionId();
    if (!text || !endpoint || !sessionId || !this.sending) return false;
    const profileId = this.turnContext?.profileId ?? this.host.profileId();
    try {
      const delivered = await steerDesktopChat(endpoint, profileId, sessionId, text);
      if (!delivered) return false;
      // Only drop it from the queue once the server owns it, so a rejected
      // steer can never lose the user's message. Re-locate it by value: the
      // queue may have shifted while the request was in flight.
      const at = this.queue.indexOf(text);
      if (at >= 0) this.queue = this.queue.filter((_, position) => position !== at);
      // Optimistic echo: the steered message is part of the agent context and
      // comes back with the post-turn reload, but the user must see it land now.
      this.host.appendUserMessage(text, []);
      this.host.afterMutate?.();
      return true;
    } catch (cause) {
      this.host.setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }

  private drainQueue(): void {
    if (this.sending || this.queue.length === 0) return;
    const { next, rest } = nextFollowUp(this.queue);
    this.queue = rest;
    // Queued follow-ups belong to the turn they were queued behind, not to
    // whatever session the host points at once the turn ends.
    if (next) void this.send({ message: next, sessionId: this.turnSessionId || undefined });
  }

  async send({ message, files = [], sessionId: sessionIdOverride, resumePlanId }: { message: string; files?: File[]; sessionId?: string; resumePlanId?: string }): Promise<void> {
    const content = message.trim();
    const hasFiles = files.length > 0;
    const endpoint = this.host.endpoint();
    const sessionId = sessionIdOverride ?? this.host.sessionId();
    // None of these guards may swallow the message: the composer is cleared by
    // the caller BEFORE send() runs and only restored on a throw, so a silent
    // return here deleted the user's text with no trace (the "second message
    // vanished" freeze). Enqueue while a turn runs; throw for the states that
    // cannot accept a turn so the caller restores the composer and reports.
    if (this.sending) {
      this.enqueue(content);
      return;
    }
    if (!endpoint || !sessionId) {
      throw new Error("No service endpoint or session selected - message not sent.");
    }
    if (this.host.canSend && !this.host.canSend()) {
      throw new Error("This session is not ready to send (model or settings still loading) - message not sent.");
    }
    if (!content && !hasFiles && !resumePlanId) return;

    // Pin the whole turn context. A queued follow-up (sessionIdOverride set)
    // lands on the SAME project/session/model as the turn it was queued behind,
    // even if the user has since navigated to another project or session; a
    // fresh user send snapshots the current host context.
    const context = sessionIdOverride && this.turnContext
      ? this.turnContext
      : {
          profileId: this.host.profileId(),
          projectId: this.host.projectId?.(),
          modelKey: this.host.modelKey?.(),
          thinkingLevel: this.host.thinkingLevel()
        };
    this.turnContext = context;

    const labels = this.host.labels();
    this.turnSequence += 1;
    this.sending = true;
    this.turnSessionId = sessionId;
    this.host.clearError();
    this.activity = hasFiles ? labels.uploading : labels.working;
    this.resetStreamBuffers();
    this.streamingText = "";
    this.streamingThinking = "";
    this.activities = [];
    this.liveSteps = [];
    this.nextLiveStep = 0;
    this.pendingApprovals = [];
    this.host.clearComposer?.();
    if (!resumePlanId) this.host.appendUserMessage(content, files);
    this.host.afterMutate?.();

    const abort = new AbortController();
    this.abort = abort;
    this.stopRequested = false;
    try {
      await runDesktopConversationTurn({
        endpoint,
        profileId: context.profileId,
        sessionId,
        projectId: context.projectId,
        modelKey: context.modelKey,
        message: content,
        thinkingLevel: context.thinkingLevel,
        files: hasFiles ? files : undefined,
        signal: abort.signal
        ,resumePlanId
      }, {
        onUploadComplete: hasFiles ? () => (this.activity = labels.recognizingImage) : undefined,
        onToken: (delta) => {
          this.activity = "";
          this.bufferLiveText("text", delta);
        },
        onReplace: (text) => {
          this.activity = "";
          // Replacement supersedes anything still buffered.
          this.pendingLiveChunks = this.pendingLiveChunks.filter((chunk) => chunk.kind !== "text");
          this.flushStreamBuffers();
          this.streamingText = text;
          this.liveSteps = this.liveSteps.filter((step) => step.kind !== "text");
          this.appendLiveText("text", text);
        },
        onThinking: (delta) => {
          this.bufferLiveText("thinking", delta);
        },
        onStatus: (text) => { if (text) this.activity = text; },
        onActivities: (next) => (this.activities = next),
        onActivity: (entry) => this.upsertLiveActivity(entry),
        onPlan: (plan) => this.appendLivePlan(plan),
        onApproval: (approval) => {
          if (this.pendingApprovals.some((item) => item.requestId === approval.requestId)) return;
          this.pendingApprovals = [...this.pendingApprovals, approval];
        },
        onTitleUpdated: () => {
          void this.host.refreshSessions?.();
        },
        onDone: (done) => {
          this.flushStreamBuffers();
          this.streamingText = done.response || this.streamingText;
          this.streamingThinking = done.thinkingText || this.streamingThinking;
        }
      });
      await this.host.refreshSessions?.();
      await this.host.reload(sessionId);
      this.resetStreamBuffers();
      this.streamingText = "";
      this.streamingThinking = "";
      this.activity = "";
      this.host.afterMutate?.();
    } catch (cause) {
      // A user Stop is not a failure. It surfaces as a plain rejection whose
      // shape depends on the transport (Tauri's HTTP plugin rejects with
      // `Error("Request cancelled")`, plain fetch with a DOMException, and the
      // server may even emit an SSE `error` frame before our own abort fires),
      // so the intent flag — not the error shape — decides whether to alarm.
      if (!this.stopRequested && !isAbortCause(cause, abort.signal)) {
        this.host.setError(cause instanceof Error ? cause.message : String(cause));
      }
      await this.host.reload(sessionId).catch(() => undefined);
    } finally {
      this.resetStreamBuffers();
      this.settleRunningActivities();
      this.sending = false;
      this.stopRequested = false;
      this.abort = null;
    }
    // A turn can end while an approval is still pending server-side (the stream
    // dropped, or the request was raised after the stream closed). Claim it
    // rather than leaving the user with an answer that says "click the card".
    if (!this.pendingApproval) {
      await this.syncPendingApproval(endpoint, context.profileId, sessionId);
    }
    // A concurrent stop() owns the drain (it still has a reload in flight that
    // would otherwise wipe the next turn's optimistic message).
    if (!this.stopInFlight) this.drainQueue();
  }

  resumePlan(planId: string): Promise<void> {
    return this.send({ message: "", resumePlanId: planId });
  }

  async stop(): Promise<void> {
    const endpoint = this.host.endpoint();
    // Stop targets the session that owns the running turn, even if the host's
    // selection moved elsewhere in the meantime.
    const sessionId = this.turnSessionId || this.host.sessionId();
    if (!endpoint || !sessionId || !this.sending) return;
    const profileId = this.turnContext?.profileId ?? this.host.profileId();
    const labels = this.host.labels();
    this.stopRequested = true;
    this.stopInFlight = true;
    try {
      // Ask the server to stop, but never let that request gate the local
      // recovery: when the service itself is wedged (the very situation Stop
      // exists for), an unbounded await here froze the button with the stream
      // still attached. Past the window we detach locally regardless.
      const stopped = await Promise.race([
        stopDesktopChat(endpoint, profileId, sessionId).catch(() => false),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_SERVER_WINDOW_MS))
      ]);
      // Keep SSE attached while the server aborts/finalizes so its persisted
      // partial answer can reach the normal done/reload path. Only detach a
      // stream that is still stuck after the bounded server-side wait.
      if (this.sending) this.abort?.abort();
      this.activity = stopped ? labels.stopped : labels.idle;
      // Let the aborted turn finish unwinding first: its own reload must not
      // land after ours, and drainQueue below is a no-op while it is sending.
      await this.waitForTurnSettled();
      await this.host.reload(sessionId);
      await this.host.refreshSessions?.();
      this.host.afterMutate?.();
    } catch (cause) {
      this.host.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this.stopInFlight = false;
    }
    // Stop ends the CURRENT turn; it does not discard what the user lined up
    // behind it. The next queued message starts now — users who want the whole
    // queue gone remove the rows with the per-row remove button.
    this.drainQueue();
  }

  /** Bounded wait for the in-flight turn to unwind after an abort. */
  private async waitForTurnSettled(timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.sending && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async resolveApproval(decision: DesktopApprovalDecision): Promise<void> {
    const endpoint = this.host.endpoint();
    if (!endpoint || !this.pendingApproval) return;
    const labels = this.host.labels();
    const requestId = this.pendingApproval.requestId;
    const sessionId = this.turnSessionId || this.host.sessionId();
    const profileId = this.turnContext?.profileId ?? this.host.profileId();
    this.pendingApprovals = this.pendingApprovals.filter((approval) => approval.requestId !== requestId);
    this.host.clearError();
    this.activity = labels.resuming;

    if (this.sending) {
      // The SSE stream from send() is still active. Just send the decision so
      // the server can continue the run; the live stream will pick up the
      // resumed output and send() will handle reload/cleanup when it ends.
      try {
        this.reportApprovalOutcome(await resolveDesktopHostBash(endpoint, profileId, sessionId, requestId, decision));
      } catch (cause) {
        this.host.setError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }

    // Offline path: the SSE stream already ended before the user acted.
    // Drive the approval → poll cycle ourselves.
    this.sending = true;
    try {
      this.reportApprovalOutcome(await resolveDesktopHostBash(endpoint, profileId, sessionId, requestId, decision));
      // The approved command runs and the original turn resumes in the background,
      // appending its answer asynchronously; poll the transcript until it lands.
      const before = this.host.getMessages().filter((message) => message.role === "assistant").length;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (sessionId !== this.host.sessionId()) return;
        await this.host.reload(sessionId);
        // The resumed turn has no SSE stream, so an approval it raises is never
        // pushed to us. Ask for it, or the user is left reading an assistant
        // message telling them to click a card that was never rendered.
        if (await this.syncPendingApproval(endpoint, profileId, sessionId)) break;
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

  /**
   * Pull a pending approval the server never got to push us, and show its card.
   * Returns whether one was adopted. Guarded on the session still being the
   * visible one (pitfall #3) — a late reply must not raise a card over a
   * session the user has already left.
   */
  private async syncPendingApproval(endpoint: string, profileId: string, sessionId: string): Promise<boolean> {
    try {
      const approvals = await loadDesktopPendingApprovals(endpoint, profileId, sessionId);
      if (!approvals.length) return false;
      if (sessionId !== this.host.sessionId()) return false;
      const known = new Set(this.pendingApprovals.map((approval) => approval.requestId));
      const fresh = approvals.filter((approval) => !known.has(approval.requestId));
      if (!fresh.length) return false;
      this.pendingApprovals = [...this.pendingApprovals, ...fresh];
      return true;
    } catch {
      // Polling is an assist, not the primary path; a hiccup must not abort the
      // resume loop that is also waiting for the answer itself.
      return false;
    }
  }

  /**
   * Show what actually happened to the approval. The click resolving fine on
   * the server while the command itself failed is the common case (wrong cwd,
   * missing binary, non-zero exit) and used to render as nothing at all.
   */
  private reportApprovalOutcome(result: DesktopApprovalResult): void {
    const labels = this.host.labels();
    if (result.status === "failed") {
      this.host.setError(`${labels.approvalFailed ?? "Approved, but the command failed"}: ${result.error || result.response}`);
      return;
    }
    if (result.status === "not_found") {
      this.host.setError(labels.approvalNotFound ?? result.response);
    }
  }
}

export function createConversationController(host: ConversationHost): ConversationController {
  return new ConversationController(host);
}
