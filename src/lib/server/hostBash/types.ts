export type HostBashApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export interface HostBashCapability {
  executable: string;
  toolId: string;
  argv: string[];
  originalSegment: string;
}

export interface HostBashSafeHelper {
  executable: string;
  argv: string[];
  originalSegment: string;
  reason: string;
}

export interface HostBashSafeGlue {
  token: "|" | "&&" | ";" | "2>&1" | "1>&2";
  reason: string;
}

export type HostBashCommandClassification =
  | {
      kind: "persistent-capability";
      capability: HostBashCapability;
      capabilities: HostBashCapability[];
      originalCommand: string;
      safeHelpers: HostBashSafeHelper[];
      safeGlue: HostBashSafeGlue[];
      warnings: string[];
    }
  | {
      kind: "compound-capabilities";
      capabilities: HostBashCapability[];
      originalCommand: string;
      safeHelpers: HostBashSafeHelper[];
      safeGlue: HostBashSafeGlue[];
      warnings: string[];
    }
  | {
      kind: "one-time-script";
      originalCommand: string;
      reason: string;
      detectedTokens: string[];
    };

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
  classification?: HostBashCommandClassification;
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
    classification?: HostBashCommandClassification;
  };
}

export interface HostBashListFilters {
  status?: HostBashApprovalStatus | "all";
  approvalMode?: HostBashApprovalMode | "all";
  query?: string;
}
