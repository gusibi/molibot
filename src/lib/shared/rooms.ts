import type { TurnRetentionPolicy, ConversationAttachment, ConversationActivity } from "./types/message.js";
export type RoomPermissionMode = "plan" | "manual" | "accept_edits" | "auto";

export type RoomExecutionStatus = "queued" | "running" | "waiting_approval" | "cancelling" | "paused" | "completed" | "failed" | "cancelled" | "interrupted";
export interface RoomParticipant { agentId: string; contextId: string; active: boolean }
export interface AgentRoom {
  id: string;
  title: string;
  primaryAgentId: string;
  projectId?: string;
  permissionMode?: RoomPermissionMode;
  participants: RoomParticipant[];
  createdAt: string;
}
export interface RoomMessage {
  id: string;
  roomId: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  authorAgentId?: string;
  authorName?: string;
  dispatchId: string;
  executionId?: string;
  replyToId?: string;
  retention: TurnRetentionPolicy;
  createdAt: string;
  attachments?: ConversationAttachment[];
  activities?: ConversationActivity[];
}
export interface RoomExecution {
  id: string;
  roomId: string;
  dispatchId: string;
  agentId: string;
  contextId: string;
  status: RoomExecutionStatus;
  mode: "plan" | "direct";
  text: string;
  snapshot: RoomMessage[];
  retention: TurnRetentionPolicy;
  order: number;
  retryOf?: string;
  approvalId?: string;
  approval?: { command: string; reason: string; displayName: string; permissionMode?: RoomPermissionMode };
  operations?: Array<{ id: string; status: string; description: string }>;
  error?: string;
  blockedBy?: { agentId: string; executionId: string; reason: "participant_busy" | "writer_busy"; waitingApproval: boolean };
  partialText: string;
  createdAt: string;
}
export interface RoomSubmission {
  submissionId: string;
  text: string;
  agentIds?: string[];
  replyToId?: string;
  attachments?: ConversationAttachment[];
}
export interface RoomDispatch { id: string; roomId: string; submissionId: string }
export interface RoomView { room: AgentRoom; messages: RoomMessage[]; executions: RoomExecution[] }
export interface RoomEvent { sequence: number; roomId: string; dispatchId?: string; agentId?: string; executionId?: string; type: "changed" | "text" | "activity"; payload: unknown }
