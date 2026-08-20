export type ExternalSubagentProviderId = "codex" | "claude-code";

export type ExternalSubagentStopReason =
  | "completed"
  | "aborted"
  | "timeout"
  | "error"
  | "not_installed";

export type CodexPermissionMode =
  | "never"
  | "approve-for-me"
  | "dangerously-bypass-approvals-and-sandbox";

export const CODEX_PERMISSION_MODES: readonly CodexPermissionMode[] = [
  "never",
  "approve-for-me",
  "dangerously-bypass-approvals-and-sandbox"
] as const;

export const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = "never";

export type ClaudeCodePermissionMode =
  | "dontAsk"
  | "acceptEdits"
  | "auto"
  | "plan"
  | "bypassPermissions";

export const CLAUDE_CODE_PERMISSION_MODES: readonly ClaudeCodePermissionMode[] = [
  "dontAsk",
  "acceptEdits",
  "auto",
  "plan",
  "bypassPermissions"
] as const;

export const DEFAULT_CLAUDE_CODE_PERMISSION_MODE: ClaudeCodePermissionMode = "dontAsk";

export interface ExternalSubagentRequest {
  task: string;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  permissionMode?: CodexPermissionMode | ClaudeCodePermissionMode;
  customPath?: string;
  env?: Record<string, string>;
}

export interface ExternalSubagentResult {
  provider: ExternalSubagentProviderId;
  output: string;
  stopReason: ExternalSubagentStopReason;
  diagnostic?: string;
  durationMs: number;
}

export interface ProviderAvailability {
  available: boolean;
  source?: "custom" | "installed" | "system";
  executablePath?: string;
  packagePath?: string;
  version?: string;
  error?: string;
}

export interface ExternalSubagentProvider {
  readonly id: ExternalSubagentProviderId;
  isAvailable(options?: { customPath?: string }): Promise<ProviderAvailability>;
  run(request: ExternalSubagentRequest): Promise<ExternalSubagentResult>;
}

export interface ExternalSubagentRuntimeOptions {
  runtimesDir?: string;
  defaultDisposeGraceMs?: number;
}
