export type HostBashApprovalStatus =
  | "pending"
  | "approved"
  | "executing"
  | "rejected"
  | "executed"
  | "failed"
  | "expired";

export type HostBashApprovalScope = "once" | "session" | "persistent";

/**
 * Who a persistent ("一直允许") grant belongs to. Approving always-on access for
 * a command grants it across every session of one bot or one project — not
 * globally across the whole install, which is what a bare `hbw-<toolId>` grant
 * used to mean. Legacy global grants are still honoured for backwards
 * compatibility; new grants always carry an owner.
 */
export type HostBashOwnerKind = "bot" | "project";

export interface HostBashOwner {
  kind: HostBashOwnerKind;
  /** Bot workspace slug, or project id. */
  id: string;
  /** Stable composite used as the grant key: `bot:<id>` / `project:<id>`. */
  key: string;
  /** Human-facing label for the approval card ("本项目" / bot name). */
  label: string;
}

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
  /** Fresh automation execution that owns this suspended tool call. */
  runId?: string;
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
  /** Owner a persistent grant would be scoped to. See {@link HostBashOwner}. */
  owner?: HostBashOwner;
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
  payload?: { path?: string; diff?: string; parameters?: Record<string, unknown> };
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
  /** Absent on legacy grants, which stay global. */
  owner?: HostBashOwner;
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
    id: "approve" | "approve_once" | "approve_session" | "approve_persistent" | "reject";
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
    owner?: HostBashOwner;
    payload?: { path?: string; diff?: string; parameters?: Record<string, unknown> };
  };
}

export interface HostBashListFilters {
  status?: HostBashApprovalStatus | "all";
  approvalMode?: HostBashApprovalMode | "all";
  query?: string;
}
