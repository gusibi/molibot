export type PiExtensionTerminalStatus = "running" | "completed" | "failed" | "stopped" | "waiting_approval";

export interface PiExtensionTerminalSummary {
  id: string;
  sessionId: string;
  runId: string;
  extensionIds: string[];
  status: PiExtensionTerminalStatus;
  createdAt: number;
  error?: string;
  contextReviewed?: boolean;
  requiresReview?: boolean;
}

export interface PiExtensionTerminalOutput {
  terminal: PiExtensionTerminalSummary;
  cursor: number;
  reset: boolean;
  output: string;
}
