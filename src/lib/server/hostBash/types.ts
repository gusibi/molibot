export type HostBashApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export type HostBashApprovalMode = "persistent" | "ephemeral" | "session";
export type HostBashNetworkAccess = "none" | "loopback" | "internet";
export type HostBashFilesystemAccess = "none" | "scratch-only" | "workspace-read" | "workspace-write";

export interface HostBashPermissions {
  envAllowlist: string[];
  filesystem: HostBashFilesystemAccess;
  network: HostBashNetworkAccess;
}

export interface HostBashPendingAction {
  kind: "run_approved_host_bash" | "run_one_time_host_script";
  originalCommand: string;
  args?: string[];
  stdin?: string;
  timeout?: number;
}

export interface HostBashApprovalRecord {
  id: string;
  toolId: string;
  displayName: string;
  command: string;
  reason: string;
  channel: string;
  chatId: string;
  scopeId: string;
  sessionId?: string;
  approvalMode: HostBashApprovalMode;
  status: HostBashApprovalStatus;
  permissions: HostBashPermissions;
  pendingAction?: HostBashPendingAction;
  requestedAt: string;
  resolvedAt?: string;
  executedAt?: string;
  approvedBashId?: string;
  errorText?: string;
}

export interface ApprovedHostBashEntry {
  id: string;
  toolId: string;
  displayName: string;
  command: string;
  reason: string;
  channel: string;
  chatId: string;
  scopeId: string;
  permissions: HostBashPermissions;
  approvedAt: string;
  approvedFromRecordId: string;
  enabled: boolean;
}

export interface HostBashApprovalPrompt {
  type: "host_bash_approval";
  requestId: string;
  title: string;
  body: string;
  options: Array<{
    id: "approve" | "approve_session" | "reject";
    label: string;
    style: "primary" | "danger";
  }>;
  request: {
    toolId: string;
    displayName: string;
    command: string;
    args: string[];
    approvalMode: HostBashApprovalMode;
    reason: string;
    permissions: HostBashPermissions;
    requestedAt: string;
  };
}

export interface HostBashListFilters {
  status?: HostBashApprovalStatus | "all";
  approvalMode?: HostBashApprovalMode | "all";
  query?: string;
}
