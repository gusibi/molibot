import { roomMentionIds } from "$lib/shared/roomMentions.js";
import { randomUUID } from "node:crypto";
import type { AgentSettings } from "$lib/server/settings/schema.js";
import { retentionCapabilities, classifyTurnRetention } from "$lib/server/sessions/retentionPolicy.js";
import type { AgentRoom, RoomSession, RoomDispatch, RoomExecution, RoomMessage, RoomSubmission, RoomView, RoomPermissionMode } from "$lib/shared/rooms.js";
import type { ConversationActivity } from "$lib/shared/types/message.js";
import { RoomStore } from "./store.js";

export interface RoomRunner {
  retention?: RoomMessage["retention"];
  run(hooks: {
    onText: (text: string) => void;
    onActivity: (activity: ConversationActivity) => void;
    onApproval: (id: string, presentation?: RoomExecution["approval"]) => Promise<void>;
  }): Promise<{ status: "completed" | "failed" | "cancelled"; text: string; error?: string; activities?: ConversationActivity[]; attachments?: RoomMessage["attachments"] }>;
  abort(): void;
  steer(text: string): boolean;
}
export interface RoomRunnerInput extends RoomExecution { room: AgentRoom; session: RoomSession; agent: AgentSettings; assertAuthority: () => void }
export interface RoomServiceDeps {
  store: RoomStore;
  agents: () => AgentSettings[];
  createSession: (input: { title: string; projectId?: string; roomId?: string }) => { id: string };
  isSessionAvailable: (id: string) => boolean;
  createRunner: (input: RoomRunnerInput) => RoomRunner;
  memberModelKey?: (room: AgentRoom, agent: AgentSettings) => string;
  contextAllowance?: (room: AgentRoom, agentId: string, input: RoomSubmission, session: RoomSession) => number;
  deleteSession?: (id: string) => void;
  renameSession?: (id: string, title: string) => void;
  assertApprovalAuthority?: (execution: RoomExecution) => void;
  resolveApproval?: (execution: RoomExecution, decision: "approve_once" | "reject") => void;
  syncTranscript?: (roomId: string, messages: RoomMessage[]) => void;
  interruptExecution?: (execution: RoomExecution) => void;
  invalidateApprovals?: (execution: RoomExecution) => void;
}
const rankPermission = (mode: RoomPermissionMode | undefined) => ({ plan: 0, manual: 1, accept_edits: 2, auto: 3 })[mode ?? "auto"];
const liveStates = new Set(["queued", "running", "waiting_approval", "cancelling", "paused"]);
export const retentionRank = { standard: 0, no_memory: 1, not_searchable: 2, turn_only: 3 } as const;

/** One shared scheduler owns Room-created runs across transports and control actions. */
export class RoomService {
  private active = new Map<string, { runner: RoomRunner; done: Promise<void> }>();
  private disposed = false;
  constructor(private deps: RoomServiceDeps) {}
  private agent(id: string): AgentSettings {
    const agent = this.deps.agents().find(a => a.id === id && a.enabled !== false);
    if (!agent) throw new Error(`Agent unavailable: ${id}`);
    return agent;
  }
  private room(id: string): AgentRoom {
    const room = this.deps.store.get(id);
    if (!room || !this.deps.isSessionAvailable(id)) throw new Error("Room unavailable");
    return room;
  }
  create(input: { title: string; agentIds: string[]; primaryAgentId?: string; projectId?: string; permissionMode?: RoomPermissionMode }): AgentRoom {
    const ids = [...new Set(input.agentIds)];
    if (!ids.length || !input.title.trim()) throw new Error("Room title and members are required");
    ids.forEach(id => this.agent(id));
    const primaryAgentId = input.primaryAgentId ?? ids[0];
    if (!ids.includes(primaryAgentId)) throw new Error("Primary must be a Room member");
    const session = this.deps.createSession(input);
    const room: AgentRoom = { id: session.id, title: input.title.trim(), primaryAgentId, projectId: input.projectId,
      permissionMode: input.permissionMode, createdAt: new Date().toISOString(),
      participants: ids.map(agentId => ({ agentId, active: true })) };
    this.deps.store.create(room);
    this.deps.store.addSession({ id: session.id, roomId: room.id, title: "", createdAt: room.createdAt,
      contexts: ids.map(agentId => ({ agentId, contextId: randomUUID() })) });
    return room;
  }
  list(): AgentRoom[] { return this.deps.store.list().filter(r => this.deps.isSessionAvailable(r.id)); }
  private session(roomId: string, sessionId?: string): RoomSession {
    const sessions = this.deps.store.sessions(roomId).filter(s => this.deps.isSessionAvailable(s.id));
    const session = sessionId ? sessions.find(s => s.id === sessionId) : sessions[0];
    if (!session || !this.deps.isSessionAvailable(session.id)) throw new Error("Room conversation unavailable");
    return session;
  }
  newSession(id: string): RoomSession {
    if (this.disposed) throw new Error("Room service is stopping");
    const room = this.room(id);
    const created = this.deps.createSession({ title: room.title, projectId: room.projectId, roomId: room.id });
    const session: RoomSession = { id: created.id, roomId: id, title: "", createdAt: new Date().toISOString(),
      contexts: room.participants.map(p => ({ agentId: p.agentId, contextId: randomUUID() })) };
    this.deps.store.addSession(session);
    this.changed(id, undefined, session.id);
    return session;
  }
  view(id: string, sessionId?: string): RoomView {
    const session = this.session(id, sessionId);
    const executions = this.deps.store.executions(id, session.id);
    const messages = this.deps.store.messages(id, session.id);
    const lastUser = messages.findLast(message => message.role === "user");
    const lastInput = lastUser ? this.deps.store.dispatchesInput(lastUser.dispatchId) : null;
    const room = this.room(id);
    const allExecutions = this.deps.store.executions(id);
    const agents = this.deps.agents();
    const memberModelKeys = Object.fromEntries(room.participants.filter(p => p.active).map(p => {
      const agent = agents.find(a => a.id === p.agentId && a.enabled !== false);
      return [p.agentId, agent ? this.deps.memberModelKey?.(room, agent) ?? "" : ""];
    }));
    return { room, session, sessions: this.deps.store.sessions(id).filter(s => this.deps.isSessionAvailable(s.id)), memberModelKeys, messages, composerSelection: lastInput ? { modelKey: lastInput.modelKey, thinkingLevel: lastInput.thinkingLevel } : undefined, executions: executions.map(e => {
      const busy = allExecutions.filter(other => ["running", "waiting_approval", "cancelling"].includes(other.status));
      const participant = e.status === "queued" ? busy.find(other => other.contextId === e.contextId) : undefined;
      const writer = e.status === "queued" && e.mode === "direct" ? busy.find(other => other.mode === "direct") ?? allExecutions.find(other => other.order < e.order && other.mode === "direct" && other.status === "queued") : undefined;
      const blocker = participant ?? writer;
      return { ...e, operations: this.deps.store.operations(e.id), blockedBy: blocker ? { agentId: blocker.agentId, executionId: blocker.id, reason: participant ? "participant_busy" as const : "writer_busy" as const, waitingApproval: blocker.status === "waiting_approval" } : undefined };
    }) };

  }
  attachments(id: string, ids: string[]) { this.room(id); return this.deps.store.files(id, ids); }
  private recipients(room: AgentRoom, input: RoomSubmission, session: RoomSession): string[] {
    const quote = input.replyToId ? this.deps.store.messages(room.id, session.id).find(m => m.id === input.replyToId) : undefined;
    if (input.replyToId && !quote) throw new Error("Reply target unavailable");
    if (quote?.executionId && !this.deps.store.executions(room.id, session.id).some(e => e.id === quote.executionId && e.status === "completed")) throw new Error("This reply is not a completed source; retry its execution instead");
    if (quote && !retentionCapabilities(quote.retention).futureContext) throw new Error("This message is not eligible for later context");
    const mentioned = roomMentionIds(input.text, this.deps.agents().filter(agent => room.participants.some(p => p.active && p.agentId === agent.id)));
    const explicit = [...new Set([...(input.agentIds ?? []), ...mentioned])];
    const ids = explicit.length ? explicit : [quote?.authorAgentId ?? room.primaryAgentId];
    for (const id of ids) {
      this.agent(id);
      if (!room.participants.some(p => p.agentId === id && p.active)) throw new Error(`Agent is not a current Room member: ${id}`);
    }
    return ids;
  }
  private snapshot(room: AgentRoom, input: RoomSubmission, ids: string[], session: RoomSession): RoomMessage[] {
    const allowance = Math.min(6_000, ...ids.map(id => this.deps.contextAllowance?.(room, id, input, session) ?? 6_000));
    if (allowance < 0) throw new Error("Required input exceeds a recipient's context allowance");
    let budget = Math.max(0, Math.floor(allowance * 2) - 200);
    const completed = new Set(this.deps.store.executions(room.id, session.id).filter(e => e.status === "completed").map(e => e.id));
    const history = this.deps.store.messages(room.id, session.id).filter(m => retentionCapabilities(m.retention).futureContext && (!m.executionId || completed.has(m.executionId)));
    const quote = history.find(m => m.id === input.replyToId);
    const selected: RoomMessage[] = [];
    const candidates = [...(quote ? [quote] : []), ...history.filter(m => m.id !== quote?.id).reverse()];
    for (const m of candidates) {
      if (budget < 120) break;
      const overhead = JSON.stringify({ ...m, content: "" }).length;
      if (budget <= overhead + 24) break;
      const max = budget - overhead;
      const content = m.content.length > max ? m.content.slice(0, Math.max(0, max - 24)) + "\n[truncated excerpt]" : m.content;
      selected.push({ ...m, content });
      budget -= overhead + content.length;
    }
    if (quote && !selected.some(m => m.id === quote.id)) throw new Error("The quoted message cannot fit the recipients' context allowance. Remove the quote or send less input.");
    return selected.sort((a, b) => a.sequence - b.sequence);
  }
  send(id: string, raw: RoomSubmission, sessionId?: string): RoomDispatch {
    if (this.disposed) throw new Error("Room service is stopping");
    const room = this.room(id);
    const session = this.session(id, sessionId);
    const input: RoomSubmission = { submissionId: raw.submissionId, text: raw.text.trim(), agentIds: raw.agentIds ? [...new Set(raw.agentIds)].sort() : undefined,
      replyToId: raw.replyToId, attachments: raw.attachments ?? [], modelKey: raw.modelKey || undefined, thinkingLevel: raw.thinkingLevel };
    if (!input.submissionId || (!input.text && !input.attachments?.length)) throw new Error("Submission ID and message are required");
    if (this.deps.store.resumeSubmission(id, input.submissionId)) throw new Error("Submission ID has a different payload");
    const existing = this.deps.store.dispatch(id, input.submissionId);
    if (existing) {
      if (existing.dispatch.sessionId !== session.id || JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error("Submission ID has a different payload");
      return existing.dispatch;
    }
    const ids = this.recipients(room, input, session);
    const snapshot = this.snapshot(room, input, ids, session);
    const ownRetention = classifyTurnRetention(input.text);
    const retention = snapshot.reduce((policy, m) => retentionRank[m.retention] > retentionRank[policy] ? m.retention : policy, ownRetention);
    const dispatch = { id: randomUUID(), roomId: id, sessionId: session.id, submissionId: input.submissionId };
    const now = new Date().toISOString();
    this.deps.store.transaction(() => {
      this.deps.store.addDispatch(dispatch, input);
      this.deps.store.nameSession(session.id, input.text.replace(/\s+/g, " ").slice(0, 60));
      this.deps.store.addMessage({ id: randomUUID(), roomId: id, role: "user", content: input.text, dispatchId: dispatch.id,
        replyToId: input.replyToId, retention: ownRetention, createdAt: now, attachments: input.attachments });
      for (const agentId of ids) this.deps.store.addExecution({ id: randomUUID(), roomId: id, dispatchId: dispatch.id, agentId,
        contextId: session.contexts.find(p => p.agentId === agentId)!.contextId, status: "queued", mode: ids.length > 1 ? "discussion" : "direct",
        text: input.text, snapshot, retention, partialText: "", createdAt: now });
    });
    this.changed(id, undefined, session.id);
    this.pump(id);
    return dispatch;
  }
  private changed(roomId: string, e?: RoomExecution, sessionId = e?.sessionId) {
    try {
      const ids = sessionId ? [sessionId] : this.deps.store.sessions(roomId).map(session => session.id);
      for (const id of ids) this.deps.syncTranscript?.(id, this.deps.store.messages(roomId, id));
    }
    catch { this.deps.store.event({ roomId, type: "changed", payload: { errorCode: "ROOM_SESSION_PROJECTION_FAILED" } }); }
    this.deps.store.event({ roomId, dispatchId: e?.dispatchId, executionId: e?.id, agentId: e?.agentId, type: "changed", payload: null });
  }
  assertAuthority(e: RoomExecution) {
    const room = this.room(e.roomId);
    this.agent(e.agentId);
    if (!room.participants.some(p => p.agentId === e.agentId && p.active)) throw new Error("Room membership revoked");
    const current = this.deps.store.executions(e.roomId).find(x => x.id === e.id);
    if (!current || !["running", "waiting_approval"].includes(current.status)) throw new Error("Execution is no longer active");
  }
  private pump(id: string) {
    if (this.disposed) return;
    let writerBlocked = false;
    for (const e of this.deps.store.executions(id).filter(e => e.status === "queued")) {
      if (e.mode === "direct" && writerBlocked) continue;
      try { this.agent(e.agentId); this.room(id); }
      catch (error) { this.deps.store.state(e.id, "cancelled", String(error)); this.changed(id, e); continue; }
      if (!this.deps.store.claim(e)) { if (e.mode === "direct") writerBlocked = true; continue; }
      this.start(e);
    }
  }
  private start(e: RoomExecution) {
    let runner: RoomRunner;
    try { runner = this.deps.createRunner({ ...e, room: this.room(e.roomId), session: this.session(e.roomId, e.sessionId), agent: structuredClone(this.agent(e.agentId)), assertAuthority: () => this.assertAuthority(e) }); }
    catch (error) { this.deps.store.state(e.id, "failed", String(error)); this.deps.store.release(e); this.changed(e.roomId, e); queueMicrotask(() => this.pump(e.roomId)); return; }
    if (runner.retention && retentionRank[runner.retention] > retentionRank[e.retention]) {
      e.retention = runner.retention;
      this.deps.store.retention(e.id, e.retention);
    }
    const authorName = this.agent(e.agentId).name;
    const work = Promise.resolve().then(async () => {
      this.changed(e.roomId, e);
      const wasCancelled = this.deps.store.executions(e.roomId).find(x => x.id === e.id)?.status === "cancelling";
      const result = wasCancelled ? { status: "cancelled" as const, text: "" } : await runner.run({
        onText: (text) => {
          this.deps.store.partial(e.id, text);
          this.deps.store.event({ roomId: e.roomId, dispatchId: e.dispatchId, agentId: e.agentId, executionId: e.id, type: "text", payload: text });
        },
        onActivity: (activity) => this.deps.store.event({ roomId: e.roomId, dispatchId: e.dispatchId, agentId: e.agentId, executionId: e.id, type: "activity", payload: activity }),
        onApproval: async (id, presentation) => {
          this.assertAuthority(e);
          this.deps.store.state(e.id, "waiting_approval", undefined, id);
          this.deps.store.approval(e.id, presentation);
          this.changed(e.roomId, e);
        }
      });
      const cancelled = this.deps.store.executions(e.roomId).find(x => x.id === e.id)?.status === "cancelling";
      this.deps.store.transaction(() => {
        this.deps.store.state(e.id, cancelled ? "cancelled" : result.status, result.error);
        if (result.text || result.attachments?.length) this.deps.store.addMessage({ id: randomUUID(), roomId: e.roomId, role: "assistant", content: result.text,
          authorAgentId: e.agentId, authorName,
          executionId: e.id, dispatchId: e.dispatchId, retention: e.retention, createdAt: new Date().toISOString(), activities: result.activities, attachments: result.attachments });
        this.deps.store.release(e);
      });
    }).catch(error => {
      const cancelling = this.deps.store.executions(e.roomId).find(x => x.id === e.id)?.status === "cancelling";
      this.deps.store.state(e.id, cancelling ? "cancelled" : "failed", error instanceof Error ? error.message : String(error));
      this.deps.store.release(e);
    }).finally(() => {
      this.active.delete(e.id);
      this.changed(e.roomId, e);
      this.pump(e.roomId);
    });
    this.active.set(e.id, { runner, done: work });
  }
  stop(id: string, executionId?: string, sessionId?: string) {
    this.room(id);
    if (sessionId) this.session(id, sessionId);
    const active: string[] = [];
    this.deps.store.transaction(() => {
      for (const e of this.deps.store.executions(id).filter(e => liveStates.has(e.status) && (!executionId || e.id === executionId) && (!sessionId || e.sessionId === sessionId))) {
        this.deps.invalidateApprovals?.(e);
        if (this.active.has(e.id)) { this.deps.store.state(e.id, "cancelling"); active.push(e.id); }
        else this.deps.store.state(e.id, "cancelled");
      }
    });
    this.deps.store.event({roomId: id, type: "changed", payload: {errorCode: "ROOM_STOP_REQUESTED", executionIds: active}});
    active.forEach(id => this.active.get(id)?.runner.abort());
    const execution = executionId ? this.deps.store.executions(id).find(e => e.id === executionId) : undefined;
    this.changed(id, execution, sessionId ?? execution?.sessionId);
  }
  resolveApproval(id: string, executionId: string, decision: "approve_once" | "reject") {
    const e = this.deps.store.executions(id).find(x => x.id === executionId);
    if (!e || e.status !== "waiting_approval" || !this.active.has(e.id)) throw new Error("Approval is no longer live");
    this.assertAuthority(e);
    this.deps.assertApprovalAuthority?.(e);
    if (!this.deps.resolveApproval) throw new Error("Approval resolution unavailable");
    this.deps.resolveApproval(e, decision);
    this.deps.store.state(e.id, "running");
    this.changed(id, e);
  }
  reconcileOperation(id: string, executionId: string, operationId: string, outcome: "completed" | "failed") {
    this.room(id);
    const e = this.deps.store.executions(id).find(x => x.id === executionId);
    const op = this.deps.store.operations(executionId).find(x => x.id === operationId);
    if (!e || !["failed", "interrupted"].includes(e.status) || op?.status !== "unknown") throw new Error("Operation cannot be reconciled");
    this.deps.store.operation(executionId, operationId, outcome, op.description);
    this.changed(id, e);
  }
  steer(id: string, executionId: string, text: string): boolean {
    this.room(id);
    const e = this.deps.store.executions(id).find(e => e.id === executionId);
    if (e?.status !== "running") return false;
    const normalized = text.trim();
    if (!normalized) return false;
    if (retentionRank[classifyTurnRetention(normalized)] > retentionRank[e.retention]) throw new Error("Steering cannot tighten an active Run's retention. Stop it and send this instruction as a new message.");
    const delivered = this.active.get(executionId)?.runner.steer(normalized) ?? false;
    if (delivered) {
      this.deps.store.addMessage({ id: randomUUID(), roomId: id, role: "user", content: normalized,
        dispatchId: e.dispatchId, retention: e.retention, createdAt: new Date().toISOString() });
      this.changed(id, e);
    }
    return delivered;
  }
  update(id: string, input: { title?: string; agentIds: string[]; primaryAgentId: string; permissionMode?: RoomPermissionMode }) {
    const room = this.room(id);
    const ids = [...new Set(input.agentIds)];
    if (!ids.length || !ids.includes(input.primaryAgentId)) throw new Error("A member and a Primary are required");
    ids.forEach(id => this.agent(id));
    const next = { ...room, title: input.title?.trim() || room.title, primaryAgentId: input.primaryAgentId,
      permissionMode: input.permissionMode, participants: room.participants.map(p => ({ ...p, active: ids.includes(p.agentId) })) };
    for (const id of ids) if (!next.participants.some(p => p.agentId === id)) next.participants.push({ agentId: id, active: true });
    this.deps.store.update(next);
    this.deps.store.ensureSessionContexts(next);
    const previousRank = rankPermission(room.permissionMode);
    if (rankPermission(next.permissionMode) < previousRank) {
      for (const e of this.deps.store.executions(id).filter(e => e.status === "waiting_approval")) this.stop(id, e.id);
    }
    this.deps.renameSession?.(id, next.title);
    for (const e of this.deps.store.executions(id)) if (!ids.includes(e.agentId) && liveStates.has(e.status)) this.stop(id, e.id);
    this.changed(id);
    return next;
  }
  reconcileAgents() {
    for (const room of this.list()) for (const e of this.deps.store.executions(room.id)) {
      if (liveStates.has(e.status) && !this.deps.agents().some(a => a.id === e.agentId && a.enabled !== false)) this.stop(room.id, e.id);
      else if (e.status === "waiting_approval") {
        try { this.deps.assertApprovalAuthority?.(e); } catch { this.stop(room.id, e.id); }
      }
    }
  }
  resume(id: string, executionId: string, submissionId: string): RoomDispatch {
    if (this.disposed) throw new Error("Room service is stopping");
    const room = this.room(id);
    if (!submissionId) throw new Error("Submission ID is required");
    const accepted = this.deps.store.resumeSubmission(id, submissionId);
    if (accepted) {
      if (accepted.executionId !== executionId) throw new Error("Submission ID has a different payload");
      return accepted.dispatch;
    }
    if (this.deps.store.dispatch(id, submissionId)) throw new Error("Submission ID has a different payload");
    const e = this.deps.store.executions(id).find(e => e.id === executionId);
    if (!e || !["failed", "interrupted", "paused"].includes(e.status)) throw new Error("Execution cannot be resumed");
    if (e.status === "paused") {
      this.agent(e.agentId);
      if (!room.participants.some(p => p.agentId === e.agentId && p.active)) throw new Error("Room membership revoked");
      const dispatch = { id: e.dispatchId, roomId: id, sessionId: e.sessionId, submissionId };
      this.deps.store.transaction(() => {
        this.deps.store.addResumeSubmission(dispatch, executionId);
        this.deps.store.state(e.id, "queued");
      });
      this.changed(id, e); this.pump(id);
      return dispatch;
    }
    if (this.deps.store.operations(e.id).some(op => op.status === "unknown")) throw new Error("An external operation has an unknown outcome; reconcile it before continuing");
    const source = this.deps.store.dispatchesInput(e.dispatchId);
    if (!source) throw new Error("Original input unavailable");
    const input: RoomSubmission = { ...source, submissionId, agentIds: [e.agentId] };
    this.recipients(room, input, this.session(id, e.sessionId));
    const d = { id: randomUUID(), roomId: id, sessionId: e.sessionId, submissionId };
    this.deps.store.transaction(() => {
      this.deps.store.addDispatch(d, input);
      this.deps.store.addResumeSubmission(d, executionId);
      this.deps.store.addExecution({ ...e, id: randomUUID(), dispatchId: d.id, retryOf: e.id, status: "queued", partialText: "", error: undefined, approvalId: undefined, createdAt: new Date().toISOString() });
    });
    this.changed(id, e); this.pump(id); return d;
  }
  delete(id: string) {
    this.room(id);
    if (this.isBusy(id)) throw new Error("Room has active or pending work");
    if (!this.deps.deleteSession) throw new Error("Session deletion unavailable");
    this.deps.deleteSession(id);
  }
  isBusy(id: string) { return this.deps.store.executions(id).some(e => liveStates.has(e.status)); }
  recover(preserve: ReadonlySet<string> = new Set()) {
    if (this.active.size) throw new Error("Cannot recover while executions are live");
    for (const room of this.deps.store.list()) for (const e of this.deps.store.executions(room.id)) {
      if (preserve.has(e.id)) continue;
      if (["running", "waiting_approval", "cancelling"].includes(e.status)) this.deps.interruptExecution?.(e);
      if (e.approvalId) this.deps.invalidateApprovals?.(e);
    }
    this.deps.store.recover(preserve);
    for (const room of this.list()) this.changed(room.id);
  }
  failNativeRecovery(roomId: string, executionId: string, error: string): void {
    const execution = this.deps.store.executions(roomId).find(e => e.id === executionId);
    if (!execution || !["running", "waiting_approval", "cancelling"].includes(execution.status) || this.active.has(execution.id)) return;
    this.deps.invalidateApprovals?.(execution);
    this.deps.store.state(execution.id, "failed", error);
    this.deps.store.release(execution);
    this.changed(roomId, execution);
  }

  resumeNativeExecution(roomId: string, executionId: string): boolean {
    const execution = this.deps.store.executions(roomId).find(e => e.id === executionId);
    if (!execution || execution.status !== "running" || this.active.has(execution.id)) return false;
    try { this.assertAuthority(execution); }
    catch (error) {
      this.deps.store.state(execution.id, "failed", String(error));
      this.deps.store.release(execution);
      this.changed(roomId, execution);
      return false;
    }
    this.start(execution);
    return true;
  }
  async dispose() {
    this.disposed = true;
    for (const room of this.list()) this.stop(room.id);
    for (const entry of this.active.values()) entry.runner.abort();
    await Promise.all([...this.active.values()].map(x => x.done));
  }
}
