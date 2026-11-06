export type PiExtensionTerminalStatus = "running" | "completed" | "failed" | "stopped" | "waiting_approval";

export interface PiExtensionDialog {
  id: string;
  kind: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  initialValue?: string;
}

export type PiExtensionCleanupStatus = "pending" | "running" | "hooks_completed" | "unknown";

export interface PiExtensionTerminalSummary {
  id: string;
  sessionId: string;
  agentId?: string;
  runId: string;
  extensionIds: string[];
  status: PiExtensionTerminalStatus;
  createdAt: number;
  error?: string;
  contextReviewed?: boolean;
  requiresReview?: boolean;
  dialog?: PiExtensionDialog;
  customInteraction?: boolean;
  cleanupStatus?: PiExtensionCleanupStatus;
  /** Released confirms the task-scoped LCU application list was empty after Stop. */
  sharingStatus?: "unverified" | "stopping" | "released" | "unknown";
  sharingRetryable?: boolean;
}

export interface PiExtensionTerminalOutput {
  terminal: PiExtensionTerminalSummary;
  cursor: number;
  reset: boolean;
  output: string;
}
