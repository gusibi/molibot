import { readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolveWebInboundFileMeta, toConversationAttachment, saveWebResponseAttachment } from "$lib/server/web/attachments.js";
import path from "node:path";
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { MomRunner } from "$lib/server/agent/core/runner.js";
import type { MomContext } from "$lib/server/agent/core/types.js";
import { RoomService, retentionRank, type RoomRunnerInput } from "./service.js";
import { RoomStore } from "./store.js";
import { roomSettings, roomPolicy, isStricter } from "./identity.js";
import { buildSystemPrompt } from "$lib/server/agent/prompts/prompt.js";
import { resolveModelSelection } from "$lib/server/agent/routing/modelRouting.js";
import { resolveProjectContext, buildRunnerProjectContext } from "$lib/server/projects/context.js";
import { getSessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { retentionCapabilities } from "$lib/server/sessions/retentionPolicy.js";
import { ConversationActivityCollector } from "$lib/server/app/conversationActivity.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { getRuntimeToolClassification } from "$lib/server/agent/tools/toolClassification.js";

let store: RoomStore | undefined;
let service: RoomService | undefined;
export function reconcileRoomAgents() { service?.reconcileAgents(); }
export function getRoomStore() { return store ??= new RoomStore(storagePaths.sessionsDbFile); }
export function purgeRoomArtifacts(id: string): boolean {
  if (!getRoomStore().get(id)) return false;
  if (roomHasWork(id)) throw new Error("Room is busy");
  rmSync(path.join(storagePaths.webWorkspaceDir, "rooms", id), { recursive: true, force: true });
  getRoomStore().purge(id);
  return true;
}
export function roomHasWork(id: string): boolean {
  return getRoomStore().executions(id).some(e => ["queued", "running", "waiting_approval", "cancelling", "paused"].includes(e.status));
}
function project(room: { projectId?: string }) {
  const result = resolveProjectContext(room.projectId);
  if (!result.ok) throw new Error(result.error);
  return result.project;
}
function available(id: string): boolean {
  const state = getSessionLifecycleStore().get(id);
  const sessions = getRuntime().sessions;
  return state?.state !== "trashed" && Boolean(sessions.getWebConversationOwner(id) || sessions.getConversationProjectId(id));
}
function createRunner(input: RoomRunnerInput) {
  const runtime = getRuntime();
  const p = project(input.room);
  const settings = structuredClone(roomSettings(runtime.getSettings(), input.agent, p));
  const policy = roomPolicy(settings, input.room, input.agent, input.mode);
  const allowance = contextAllowance(input.room, input.agentId, { submissionId: input.dispatchId, text: input.text, attachments: getRoomStore().dispatchesInput(input.dispatchId)?.attachments });
  if (Math.ceil(JSON.stringify(input.snapshot).length / 2) > allowance) throw new Error("The accepted Room snapshot cannot fit the current model. Send a new explicit message.");
  const workspace = path.join(storagePaths.webWorkspaceDir, "rooms", input.room.id, "runtime");
  const contextStore = new MomRuntimeStore(workspace);
  const runner = new MomRunner("web", input.room.id, input.contextId, contextStore, () => settings,
    runtime.updateSettings, runtime.usageTracker, runtime.modelErrorTracker, runtime.memory, runtime.hookManager, undefined,
    { agentId: input.agentId, roomId: input.roomId, executionId: input.id });
  const retainedEntries = contextStore.listSessionMessageEntries(input.roomId, input.contextId).filter(entry => retentionCapabilities(entry.retention).futureContext);
  const retention = retainedEntries.reduce((policy, entry) => entry.retention && retentionRank[entry.retention] > retentionRank[policy] ? entry.retention : policy, input.retention);
  const presentRuns = new Set(retainedEntries.flatMap(entry => entry.runId ? [entry.runId] : []));
  const ownSources = getRoomStore().contextSourceDispatches(input.roomId, input.contextId, presentRuns);
  const shared = input.snapshot.filter(m => !(ownSources.has(m.dispatchId) && (m.role === "user" || m.authorAgentId === input.agentId)));
  const assertAuthority = (toolId: string) => {
    input.assertAuthority();
    const now = runtime.getSettings();
    const agent = now.agents.find(a => a.id === input.agentId && a.enabled !== false);
    if (!agent) throw new Error("Agent authority revoked");
    const room = getRoomStore().get(input.roomId);
    if (!room) throw new Error("Room unavailable");
    const current = roomPolicy(now, room, agent, input.mode);
    if (getRuntimeToolClassification(toolId).effect !== "read" && isStricter(current, policy)) throw new Error("Permissions changed; start a new Run under the current restrictions");
  };
  return {
    retention,
    abort: () => runner.abort(),
    steer: (text: string) => runner.steer(text),
    run: async (hooks: Parameters<import("./service.js").RoomRunner["run"]>[0]) => {
      const collector = new ConversationActivityCollector();
      let text = "";
      const outputAttachments: import("$lib/shared/types/message.js").ConversationAttachment[] = [];
      const noOp = async () => {};
      const original = getRoomStore().dispatchesInput(input.dispatchId);
      const message = { chatId: input.roomId, chatType: "private" as const, messageId: Date.now(), userId: "owner", text: input.text,
        ts: input.createdAt, attachments: (original?.attachments ?? []).map(a => ({ ...a, isImage: a.mediaType === "image", isAudio: a.mediaType === "audio" })), imageContents: (original?.attachments ?? []).filter(a => a.mediaType === "image").map(a => ({ type: "image" as const, mimeType: a.mimeType || "image/jpeg", data: readFileSync(path.join(workspace, a.local)).toString("base64") })) };
      const ctx: MomContext = {
        channel: "web", workspaceDir: workspace, chatDir: contextStore.getChatDir(input.roomId), message,
        awaitToolQuiescence: true, approvalWaitTimeoutMs: Infinity, retention, executionPolicy: policy, assertToolAuthority: assertAuthority,
        project: buildRunnerProjectContext(p, contextStore.getScratchDir(input.roomId)),
        sharedRoomContext: JSON.stringify(shared.map(m => ({ sourceId: m.id, author: m.authorName ?? "user", text: m.content, attachments: m.attachments }))),
        executionHistory: input.retryOf ? JSON.stringify(getRoomStore().operations(input.retryOf)) : undefined,
        respond: async (value) => { text = value; hooks.onText(text); }, replaceMessage: async (value) => { text = value; hooks.onText(text); },
        commitMainAnswer: async (value) => { text = value; hooks.onText(text); }, respondInThread: noOp,
        setTyping: noOp, setWorking: noOp, deleteMessage: noOp, uploadFile: async (filePath, title) => {
          const attachment = saveWebResponseAttachment({ store: contextStore, externalUserId: input.roomId, filePath, title });
          getRoomStore().saveFile(randomUUID(), input.roomId, attachment);
          outputAttachments.push(attachment);
        },
        onRunnerEvent: async (event) => { const activity = collector.record(event); if (activity) hooks.onActivity(activity); },
        onApprovalRequest: async (request) => {
          assertAuthority(request.prompt.request.toolId);
          await hooks.onApproval(request.requestId, { command: request.prompt.request.command, reason: request.prompt.request.reason, displayName: request.prompt.request.displayName, permissionMode: policy.mode });
          return "wait";
        },
        onToolSideEffectPreflight: async (effect) => {
          assertAuthority(effect.toolId);
          let previousId = input.retryOf;
          while (previousId) {
            if (getRoomStore().operations(previousId).some(op => op.id === effect.idempotencyKey && op.status === "completed")) throw new Error("This operation already completed in an earlier execution; automatic repetition is blocked");
            previousId = getRoomStore().executions(input.roomId).find(e => e.id === previousId)?.retryOf;
          }
          getRoomStore().operation(input.id, effect.idempotencyKey, "unknown", `${effect.toolId}: ${effect.targetSummary}`);
        },
        onToolSideEffectReceipt: async (effect, result) => {
          getRoomStore().operation(input.id, effect.idempotencyKey, result.ok ? "completed" : "unknown", `${effect.toolId}: ${effect.targetSummary}`);
        }
      };
      getRoomStore().recordContextRun(input.id, input.id);
      const turn = getTurnOrchestrator().prepareTurn({ chatId: input.roomId, sessionId: input.contextId, message: { ...message, runId: input.id } });
      const result = await runner.run({ ...ctx, message: { ...message, runId: turn.runId, workspaceId: turn.workspaceId } });
      return { status: result.stopReason === "stop" ? "completed" as const : result.stopReason === "aborted" ? "cancelled" as const : "failed" as const,
        text, attachments: outputAttachments, error: result.errorMessage, activities: collector.finalSnapshot() };
    }
  };
}
function contextAllowance(room: import("$lib/shared/rooms.js").AgentRoom, agentId: string, input: import("$lib/shared/rooms.js").RoomSubmission): number {
  const runtime = getRuntime();
  const agent = runtime.getSettings().agents.find(a => a.id === agentId && a.enabled !== false);
  if (!agent) throw new Error("Agent unavailable");
  const p = project(room);
  const settings = roomSettings(runtime.getSettings(), agent, p);
  const model = resolveModelSelection(settings).model;
  const workspace = path.join(storagePaths.webWorkspaceDir, "rooms", room.id, "runtime");
  const contextStore = new MomRuntimeStore(workspace);
  const contextId = room.participants.find(m => m.agentId === agentId)?.contextId;
  const privateTokens = contextId ? contextStore.getSessionStatusSnapshot(room.id, contextId).estimatedContextTokens : 0;
  const instructions = buildSystemPrompt(workspace, room.id, contextId ?? room.id, "", { settings, agentId, channel: "web", project: buildRunnerProjectContext(p, contextStore.getScratchDir(room.id)) });
  const inputTokens = Math.ceil(JSON.stringify(input).length / 2) + (input.attachments?.filter(a => a.mediaType === "image").length ?? 0) * 4096;
  return (model.contextWindow ?? settings.compaction.defaultContextWindow) - privateTokens - Math.ceil(instructions.length / 2) - inputTokens - Math.max(4000, settings.compaction.reserveTokens);
}
export function getRoomService(): RoomService {
  if (service) return service;
  const runtime = getRuntime();
  const roomStore = getRoomStore();
  service = new RoomService({
    syncTranscript: (id, messages) => runtime.sessions.syncProjectedMessages(id, messages.map(m => ({ ...m, conversationId: id }))),
    store: roomStore, agents: () => runtime.getSettings().agents,
    createSession: (input) => {
      project(input);
      const s = input.projectId ? runtime.sessions.createProjectConversation(input.projectId, "web:default:owner", "web", "agent-room") : runtime.sessions.createWebConversation("web:default:owner", "agent-room");
      runtime.sessions.renameConversation(s.id, "web", "web:default:owner", input.title);
      return s;
    },
    isSessionAvailable: available,
    renameSession: (id, title) => { runtime.sessions.renameConversation(id, "web", "web:default:owner", title); },
    deleteSession: (id) => {
      const result = runtime.sessionLifecycle.trash({ conversationId: id, requesterExternalUserId: "web:default:owner" });
      if (result.status !== "succeeded") throw new Error(`Session deletion refused: ${result.status}`);
    },
    contextAllowance,
    createRunner,
    assertApprovalAuthority: (e) => {
      const room = roomStore.get(e.roomId);
      const agent = runtime.getSettings().agents.find(a => a.id === e.agentId && a.enabled !== false);
      if (!room || !agent || !room.participants.some(p => p.agentId === e.agentId && p.active)) throw new Error("Approval authority revoked");
      const current = roomPolicy(runtime.getSettings(), room, agent, e.mode);
      if (current.mode === "plan" || (e.approval?.permissionMode && isStricter(current, { mode: e.approval.permissionMode, source: "agent", executionTarget: "none" }))) throw new Error("Approval authority revoked by current restrictions");
    },
    resolveApproval: (e, decision) => {
      if (!e.approvalId) throw new Error("Approval unavailable");
      const room = roomStore.get(e.roomId);
      const agent = runtime.getSettings().agents.find(a => a.id === e.agentId && a.enabled !== false);
      if (!room || !agent || !room.participants.some(p => p.agentId === e.agentId && p.active)) throw new Error("Approval authority revoked");
      // Approval always uses current restrictions; the suspended request cannot widen them.
      if (roomPolicy(runtime.getSettings(), room, agent, e.mode).mode === "plan") throw new Error("Approval authority revoked by Plan mode");
      const broker = getApprovalBroker();
      const request = broker.getRequest(e.approvalId);
      if (request) {
        if (request.status !== "pending" || request.actorId !== e.agentId || request.sessionId !== e.contextId) throw new Error("Approval identity mismatch");
        broker.resolveRequest({ requestId: request.id, status: decision === "reject" ? "rejected" : "approved", selectedScope: "once" });
      } else {
        const host = getHostBashStore();
        const record = host.getApprovalRecord(e.approvalId);
        if (!record || record.status !== "pending" || record.sessionId !== e.contextId || record.scopeId !== e.roomId || record.owner?.kind !== "agent" || record.owner.id !== e.agentId) throw new Error("Approval identity mismatch");
        if (decision === "reject") host.reject(e.roomId, e.approvalId, e.contextId);
        else host.approve(e.roomId, e.approvalId, { scope: "once", persistWhitelist: false, sessionId: e.contextId });
      }
    },
    interruptExecution: (e) => {
      const runId = getRoomStore().contextRun(e.id);
      if (runId) getTurnOrchestrator().updateRunStatus(runId, "interrupted", "Room runtime restarted");
    },
    invalidateApprovals: (e) => {
      if (e.approvalId) {
        getApprovalBroker().resolveRequest({ requestId: e.approvalId, status: "rejected" });
        getHostBashStore().expirePending(e.approvalId);
      }
    }
  });
  service.recover();
  return service;
}

export async function saveRoomFile(roomId: string, file: File) {
  getRoomService().view(roomId);
  const bytes = Buffer.from(await file.arrayBuffer());
  const workspace = path.join(storagePaths.webWorkspaceDir, "rooms", roomId, "runtime");
  const attachment = toConversationAttachment(new MomRuntimeStore(workspace).saveAttachment(roomId, file.name, String(Date.now() / 1000), bytes, resolveWebInboundFileMeta(file)));
  const id = randomUUID();
  getRoomStore().saveFile(id, roomId, attachment);
  return { id, attachment };
}
