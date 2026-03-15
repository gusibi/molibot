import type { AcpApprovalMode } from "../settings/index.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JsonRpcErrorPayload;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
  description: string;
}

export interface AcpToolCallSnapshot {
  id: string;
  kind: string;
  title: string;
  status: string;
  locations: string[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpPromptResult {
  stopReason: string;
  assistantText: string;
  lastStatus: string;
  toolCalls: AcpToolCallSnapshot[];
}

export interface AcpTaskCallbacks {
  onStatus: (text: string) => Promise<void>;
  onEvent: (text: string) => Promise<void>;
  onPermissionRequest?: (permission: AcpPendingPermissionView) => Promise<void>;
}

export interface AcpPendingPermissionView {
  id: string;
  title: string;
  kind: string;
  options: AcpPermissionOption[];
  createdAt: string;
  inputPreview?: string;
}

export interface AcpSessionSummary {
  targetId: string;
  projectId: string;
  projectPath: string;
  remoteSessionId: string;
  approvalMode: AcpApprovalMode;
  title: string;
  running: boolean;
  lastStatus: string;
  lastStopReason?: string;
  lastError?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  availableCommands: string[];
  pendingPermissions: AcpPendingPermissionView[];
}

export interface AcpListedSession {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt?: string;
}

export interface AcpSessionsList {
  targetId: string;
  projectId?: string;
  currentSessionId?: string;
  sessions: AcpListedSession[];
}
