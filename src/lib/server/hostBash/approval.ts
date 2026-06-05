import type {
  HostBashApprovalMode,
  HostBashApprovalPrompt,
  HostBashCommandClassification,
  HostBashApprovalRecord,
  HostBashFilesystemAccess,
  HostBashNetworkAccess,
  HostBashPendingAction,
  HostBashPermissions
} from "$lib/server/hostBash/types.js";
import { classifyHostBashCommand } from "$lib/server/hostBash/commandClassifier.js";

export const defaultHostBashPermissions: HostBashPermissions = {
  envAllowlist: [],
  filesystem: "scratch-only",
  network: "none"
};

const FORBIDDEN_HOST_COMMANDS = new Set(["bash", "sh", "zsh", "fish", "node", "python", "python3", "ruby", "perl"]);
const FORBIDDEN_SHELL_TOKENS = new Set(["|", "||", "&", "&&", ";", ">", ">>", "<", "<<"]);

function sanitizeString(input: unknown, fallback = ""): string {
  return String(input ?? fallback).trim();
}

function sanitizeStringList(input: unknown): string[] {
  const rows = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/\r?\n|,/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = sanitizeString(row);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sanitizeOptionalString(input: unknown, maxLength: number): string | undefined {
  const value = sanitizeString(input);
  return value ? value.slice(0, maxLength) : undefined;
}

function sanitizeArgList(input: unknown): string[] {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((item) => sanitizeString(item).slice(0, 4096))
    .filter(Boolean)
    .slice(0, 80);
}

function sanitizeFilesystem(input: unknown): HostBashFilesystemAccess {
  const value = sanitizeString(input);
  if (value === "none" || value === "scratch-only" || value === "workspace-read" || value === "workspace-write") {
    return value;
  }
  return defaultHostBashPermissions.filesystem;
}

function sanitizeNetwork(input: unknown): HostBashNetworkAccess {
  const value = sanitizeString(input);
  if (value === "none" || value === "loopback" || value === "internet") return value;
  return defaultHostBashPermissions.network;
}

export function sanitizeHostBashId(input: unknown): string {
  return sanitizeString(input)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function sanitizeHostBashPermissions(input: unknown): HostBashPermissions {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    envAllowlist: sanitizeStringList(source.envAllowlist ?? source.env),
    filesystem: sanitizeFilesystem(source.filesystem),
    network: sanitizeNetwork(source.network)
  };
}

export function isForbiddenHostBashCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return FORBIDDEN_HOST_COMMANDS.has(first);
}

export function sanitizeHostBashCommand(input: unknown): string {
  const command = sanitizeString(input).split(/\s+/)[0] ?? "";
  if (!command || isForbiddenHostBashCommand(command)) return "";
  return command.slice(0, 240);
}

export function sanitizeHostBashPendingAction(input: unknown): HostBashPendingAction | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const kind = sanitizeString(source.kind);
  if (kind !== "run_approved_host_bash" && kind !== "run_one_time_host_script") return undefined;
  const originalCommand = sanitizeString(source.originalCommand).slice(0, 4000);
  const args = kind === "run_approved_host_bash" ? sanitizeArgList(source.args) : undefined;
  const stdin = sanitizeOptionalString(source.stdin, 20000);
  const timeoutRaw = Number(source.timeout);
  const timeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.min(Math.round(timeoutRaw), 600) : undefined;
  return { kind, originalCommand, args, stdin, timeout };
}

export function parseHostBashShellCommand(input: string): {
  command: string;
  args: string[];
  originalCommand: string;
} {
  const raw = sanitizeString(input);
  if (!raw) throw new Error("command is required for host bash approval requests.");

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? "";
    const next = raw[i + 1] ?? "";

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null; else current += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if ((ch === "$" && next === "(") || ch === "`") {
      throw new Error("Host Bash approval only supports a single executable command with structured argv. Shell expansion is not allowed.");
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (FORBIDDEN_SHELL_TOKENS.has(ch) || FORBIDDEN_SHELL_TOKENS.has(`${ch}${next}`)) {
      throw new Error("Host Bash approval only supports a single executable command with structured argv. Pipes, redirects, and chained shell operators are not allowed.");
    }
    current += ch;
  }

  if (escaping || quote) {
    throw new Error("Host Bash approval command has unmatched quotes or escapes.");
  }
  if (current) tokens.push(current);
  if (tokens.length === 0) {
    throw new Error("command is required for host bash approval requests.");
  }

  const command = sanitizeHostBashCommand(tokens[0]);
  if (!command) {
    const first = sanitizeString(tokens[0]);
    throw new Error(
      first && isForbiddenHostBashCommand(first)
        ? `Host Bash command is not allowed: ${first}`
        : "command is required for host bash approval requests."
    );
  }
  return {
    command,
    args: tokens.slice(1).map((item) => item.slice(0, 4096)).slice(0, 80),
    originalCommand: raw.slice(0, 4000)
  };
}

function buildApprovalId(toolId: string): string {
  return `hba-${toolId}-${Date.now().toString(36)}`;
}

interface PersistentHostBashCommand {
  approvalMode: "persistent";
  toolId: string;
  command: string;
  args: string[];
  originalCommand: string;
  classification?: HostBashCommandClassification;
}

interface EphemeralHostBashCommand {
  approvalMode: "ephemeral";
  toolId: string;
  command: string;
  originalCommand: string;
  classification?: HostBashCommandClassification;
}

export type ParsedHostBashApprovalCommand = PersistentHostBashCommand | EphemeralHostBashCommand;

export function parseHostBashApprovalCommand(input: string): ParsedHostBashApprovalCommand {
  const raw = sanitizeString(input);
  if (!raw) throw new Error("command is required for host bash approval requests.");

  const classification = classifyHostBashCommand(raw);
  if (classification.kind === "persistent-capability") {
    const capability = classification.capability;
    return {
      approvalMode: "persistent",
      toolId: sanitizeHostBashId(capability.toolId),
      command: sanitizeHostBashCommand(capability.executable),
      args: capability.argv.map((item) => item.slice(0, 4096)).slice(0, 80),
      originalCommand: classification.originalCommand,
      classification
    };
  }

  if (classification.kind === "compound-capabilities") {
    const distinctToolIds = [...new Set(classification.capabilities.map((item) => item.toolId))];
    if (distinctToolIds.length === 1) {
      const primary = classification.capabilities.find((item) => item.toolId === distinctToolIds[0]) ?? classification.capabilities[0];
      return {
        approvalMode: "persistent",
        toolId: sanitizeHostBashId(primary.toolId),
        command: sanitizeHostBashCommand(primary.executable),
        args: primary.argv.map((item) => item.slice(0, 4096)).slice(0, 80),
        originalCommand: classification.originalCommand,
        classification
      };
    }
  }

  const firstToken = raw.split(/\s+/)[0] ?? "";
  const sanitizedFirst = sanitizeHostBashCommand(firstToken);
  const toolId = sanitizeHostBashId(sanitizedFirst ? `one-time-${sanitizedFirst}` : "one-time-host-script");
  return {
    approvalMode: "ephemeral",
    toolId,
    command: raw.slice(0, 240),
    originalCommand: raw.slice(0, 4000),
    classification
  };
}

export function buildHostBashApprovalPrompt(request: HostBashApprovalRecord): HostBashApprovalPrompt {
  const isOneTime = request.approvalMode === "ephemeral";
  const isSession = request.approvalMode === "session";
  const command = request.pendingAction?.originalCommand
    || [request.command, ...(request.pendingAction?.args ?? [])].filter(Boolean).join(" ");
  const operation = isOneTime
    ? "执行 Bash（仅此命令一次）"
    : isSession
      ? "执行 Bash（仅当前会话允许 Host Bash）"
      : `执行 Bash（并长期允许 ${request.displayName}）`;
  return {
    type: "host_bash_approval",
    requestId: request.id,
    title: "⚠️ 需要你的确认",
    body: `【操作】${operation}\n【命令】${command}`,
    options: [
      { id: "approve", label: "批准", style: "primary" },
      { id: "approve_session", label: "本轮允许", style: "primary" },
      { id: "reject", label: "拒绝", style: "danger" }
    ],
    request: {
      toolId: request.toolId,
      displayName: request.displayName,
      command: request.command,
      args: request.pendingAction?.args ?? [],
      approvalMode: request.approvalMode,
      reason: request.reason,
      permissions: request.permissions,
      requestedAt: request.requestedAt,
      classification: request.classification
    }
  };
}

export function buildNonInteractiveHostBashApprovalText(prompt: HostBashApprovalPrompt): string {
  const isOneTime = prompt.request.approvalMode === "ephemeral";
  const approveEffect = isOneTime
    ? "仅执行这条命令一次"
    : "执行并长期允许此工具";
  return [
    prompt.title,
    "我即将执行以下操作：",
    "",
    prompt.body,
    "",
    "请回复：",
    `✅ 回复「批准」${approveEffect}`,
    "🟡 回复「本轮允许」执行并仅在当前会话允许 Host Bash",
    "❌ 回复「拒绝」取消执行"
  ].join("\n");
}

export function coerceApprovalMode(input: unknown): HostBashApprovalMode {
  const value = sanitizeString(input);
  if (value === "ephemeral" || value === "session") return value;
  return "persistent";
}

export function createHostBashApprovalRecord(input: {
  toolId?: unknown;
  displayName?: unknown;
  command: unknown;
  reason: unknown;
  approvalMode?: unknown;
  permissions?: unknown;
  pendingAction?: unknown;
  classification?: HostBashCommandClassification;
  channel: unknown;
  chatId: unknown;
  scopeId: unknown;
  sessionId?: unknown;
}): HostBashApprovalRecord {
  const command = sanitizeHostBashCommand(input.command);
  const toolId = sanitizeHostBashId(input.toolId ?? command);
  const approvalMode = coerceApprovalMode(input.approvalMode);
  const reason = sanitizeString(input.reason).slice(0, 1000);
  const channel = sanitizeString(input.channel).slice(0, 80);
  const chatId = sanitizeString(input.chatId).slice(0, 160);
  const scopeId = sanitizeString(input.scopeId).slice(0, 200);
  const sessionId = sanitizeOptionalString(input.sessionId, 200);
  const displayName = sanitizeString(input.displayName, toolId || command).slice(0, 120) || toolId || command;
  const pendingAction = sanitizeHostBashPendingAction(input.pendingAction);
  const effectiveCommand = approvalMode === "ephemeral"
    ? sanitizeString(input.command).slice(0, 240)
    : command;

  if (!effectiveCommand) {
    const rawCommand = sanitizeString(input.command);
    throw new Error(
      rawCommand && isForbiddenHostBashCommand(rawCommand)
        ? `Host Bash command is not allowed: ${rawCommand}`
        : "command is required for host bash approval requests."
    );
  }
  if (!toolId) throw new Error("toolId is required for host bash approval requests.");
  if (!reason) throw new Error("reason is required for host bash approval requests.");

  return {
    id: buildApprovalId(toolId),
    toolId,
    displayName,
    command: effectiveCommand,
    reason,
    permissions: sanitizeHostBashPermissions(input.permissions),
    channel,
    chatId,
    scopeId,
    sessionId,
    requestedAt: new Date().toISOString(),
    approvalMode,
    status: "pending",
    pendingAction,
    classification: input.classification
  };
}
