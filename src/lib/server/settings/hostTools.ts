import type {
  ApprovedHostTool,
  HostToolApprovalRequest,
  HostToolApprovalMode,
  HostToolFilesystemAccess,
  HostToolNetworkAccess,
  HostToolPendingAction,
  HostToolPermissions,
  HostToolSettings
} from "$lib/server/settings/schema.js";

export const defaultHostToolPermissions: HostToolPermissions = {
  envAllowlist: [],
  filesystem: "scratch-only",
  network: "none"
};

export const defaultHostToolSettings: HostToolSettings = {
  pendingApprovals: [],
  approvalHistory: [],
  approvedTools: []
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

function sanitizeFilesystem(input: unknown): HostToolFilesystemAccess {
  const value = sanitizeString(input);
  if (value === "none" || value === "scratch-only" || value === "workspace-read" || value === "workspace-write") {
    return value;
  }
  return defaultHostToolPermissions.filesystem;
}

function sanitizeNetwork(input: unknown): HostToolNetworkAccess {
  const value = sanitizeString(input);
  if (value === "none" || value === "loopback" || value === "internet") return value;
  return defaultHostToolPermissions.network;
}

export function sanitizeHostToolId(input: unknown): string {
  return sanitizeString(input)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function sanitizeHostToolPermissions(input: unknown): HostToolPermissions {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    envAllowlist: sanitizeStringList(source.envAllowlist ?? source.env),
    filesystem: sanitizeFilesystem(source.filesystem),
    network: sanitizeNetwork(source.network)
  };
}

export function isForbiddenHostCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0]?.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return FORBIDDEN_HOST_COMMANDS.has(first);
}

export function sanitizeHostCommand(input: unknown): string {
  const command = sanitizeString(input).split(/\s+/)[0] ?? "";
  if (!command || isForbiddenHostCommand(command)) return "";
  return command.slice(0, 240);
}

function sanitizeHostToolPendingAction(input: unknown): HostToolPendingAction | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const kind = sanitizeString(source.kind);
  if (kind !== "run_approved_host_tool" && kind !== "run_one_time_host_script") return undefined;
  const originalCommand = sanitizeString(source.originalCommand).slice(0, 4000);
  const args = kind === "run_approved_host_tool" ? sanitizeArgList(source.args) : undefined;
  const stdin = sanitizeOptionalString(source.stdin, 20000);
  const timeoutRaw = Number(source.timeout);
  const timeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.min(Math.round(timeoutRaw), 600) : undefined;
  return {
    kind,
    originalCommand,
    args,
    stdin,
    timeout
  };
}

export interface HostToolApprovalPrompt {
  type: "host_tool_approval";
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
    approvalMode: HostToolApprovalMode;
    reason: string;
    permissions: HostToolPermissions;
    requestedAt: string;
  };
}

export function buildHostToolApprovalPrompt(request: HostToolApprovalRequest): HostToolApprovalPrompt {
  const approvalLabel = request.approvalMode === "ephemeral" ? "One-time host approval" : "Host tool approval";
  return {
    type: "host_tool_approval",
    requestId: request.id,
    title: `${approvalLabel}: ${request.displayName}`,
    body: [
      `Mode: ${request.approvalMode === "ephemeral" ? "one-time" : "persistent"}`,
      `Tool ID: ${request.toolId}`,
      `Command: ${request.command}`,
      request.pendingAction?.args?.length ? `Args: ${request.pendingAction.args.join(" ")}` : "",
      `Reason: ${request.reason}`,
      `Permissions: filesystem=${request.permissions.filesystem}, network=${request.permissions.network}, env=${request.permissions.envAllowlist.join(", ") || "(none)"}`
    ].filter(Boolean).join("\n"),
    options: [
      { id: "approve", label: "Approve", style: "primary" },
      { id: "approve_session", label: "Approve This Session", style: "primary" },
      { id: "reject", label: "Reject", style: "danger" }
    ],
    request: {
      toolId: request.toolId,
      displayName: request.displayName,
      command: request.command,
      args: request.pendingAction?.args ?? [],
      approvalMode: request.approvalMode,
      reason: request.reason,
      permissions: request.permissions,
      requestedAt: request.requestedAt
    }
  };
}

export function buildNonInteractiveHostToolApprovalText(prompt: HostToolApprovalPrompt): string {
  const isEphemeral = prompt.request.approvalMode === "ephemeral";
  return [
    prompt.title,
    prompt.body,
    "",
    "This channel does not support approval buttons.",
    isEphemeral
      ? "Approving this request will allow only this exact host command/script to run once."
      : "Approving this request will register the command as a reusable host capability for later runs.",
    "Reply `本session允许` or `approve session` to allow this request and auto-approve sandbox fallback for the current session only.",
    "Reply `批准`, `安装`, or `approve` to approve when exactly one host-tool approval is pending in this chat.",
    "Reply `拒绝` or `reject` to reject when exactly one host-tool approval is pending in this chat.",
    "If multiple approvals are pending, use:",
    `- /hosttools approve ${prompt.requestId}`,
    `- /hosttools approve-session ${prompt.requestId}`,
    `- /hosttools reject ${prompt.requestId}`
  ].join("\n");
}

export function parseHostToolShellCommand(input: string): {
  command: string;
  args: string[];
  originalCommand: string;
} {
  const raw = sanitizeString(input);
  if (!raw) throw new Error("command is required for host tool approval requests.");

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
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }

    if ((ch === "$" && next === "(") || ch === "`") {
      throw new Error("Host approval only supports a single executable command with structured argv. Shell expansion is not allowed.");
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (FORBIDDEN_SHELL_TOKENS.has(ch) || FORBIDDEN_SHELL_TOKENS.has(`${ch}${next}`)) {
      throw new Error("Host approval only supports a single executable command with structured argv. Pipes, redirects, and chained shell operators are not allowed.");
    }

    current += ch;
  }

  if (escaping || quote) {
    throw new Error("Host approval command has unmatched quotes or escapes.");
  }
  if (current) tokens.push(current);
  if (tokens.length === 0) {
    throw new Error("command is required for host tool approval requests.");
  }

  const command = sanitizeHostCommand(tokens[0]);
  if (!command) {
    const first = sanitizeString(tokens[0]);
    throw new Error(
      first && isForbiddenHostCommand(first)
        ? `Host tool command is not allowed: ${first}`
        : "command is required for host tool approval requests."
    );
  }
  return {
    command,
    args: tokens.slice(1).map((item) => item.slice(0, 4096)).slice(0, 80),
    originalCommand: raw.slice(0, 4000)
  };
}

function buildApprovalId(toolId: string): string {
  return `hta-${toolId}-${Date.now().toString(36)}`;
}

interface PersistentHostToolCommand {
  approvalMode: "persistent";
  toolId: string;
  command: string;
  args: string[];
  originalCommand: string;
}

interface EphemeralHostToolCommand {
  approvalMode: "ephemeral";
  toolId: string;
  command: string;
  originalCommand: string;
}

export type ParsedHostToolApprovalCommand = PersistentHostToolCommand | EphemeralHostToolCommand;

export function parseHostToolApprovalCommand(input: string): ParsedHostToolApprovalCommand {
  const raw = sanitizeString(input);
  if (!raw) {
    throw new Error("command is required for host tool approval requests.");
  }

  const hasCompoundShellSyntax =
    /[\r\n]/.test(raw) ||
    Array.from(FORBIDDEN_SHELL_TOKENS).some((token) => raw.includes(token)) ||
    raw.includes("$(") ||
    raw.includes("`");

  if (hasCompoundShellSyntax) {
    const firstToken = raw.split(/\s+/)[0] ?? "";
    const sanitizedFirst = sanitizeHostCommand(firstToken);
    const toolId = sanitizeHostToolId(sanitizedFirst ? `one-time-${sanitizedFirst}` : "one-time-host-script");
    return {
      approvalMode: "ephemeral",
      toolId,
      command: sanitizedFirst || "host-script",
      originalCommand: raw.slice(0, 4000)
    };
  }

  try {
    const parsed = parseHostToolShellCommand(raw);
    return {
      approvalMode: "persistent",
      toolId: sanitizeHostToolId(parsed.command),
      command: parsed.command,
      args: parsed.args,
      originalCommand: parsed.originalCommand
    };
  } catch (error) {
    const firstToken = raw.split(/\s+/)[0] ?? "";
    const sanitizedFirst = sanitizeHostCommand(firstToken);
    const toolId = sanitizeHostToolId(sanitizedFirst ? `one-time-${sanitizedFirst}` : "one-time-host-script");
    return {
      approvalMode: "ephemeral",
      toolId,
      command: sanitizedFirst || "host-script",
      originalCommand: raw.slice(0, 4000)
    };
  }
}

function sanitizeApproval(input: unknown): HostToolApprovalRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const id = sanitizeString(source.id).slice(0, 80);
  const toolId = sanitizeHostToolId(source.toolId);
  const approvalModeRaw = sanitizeString(source.approvalMode);
  const approvalMode: HostToolApprovalMode = approvalModeRaw === "ephemeral" ? "ephemeral" : "persistent";
  const command = approvalMode === "ephemeral"
    ? sanitizeString(source.command).slice(0, 240)
    : sanitizeHostCommand(source.command);
  if (!id || !toolId || !command) return null;
  const statusRaw = sanitizeString(source.status);
  const status = statusRaw === "approved" || statusRaw === "rejected" ? statusRaw : "pending";
  return {
    id,
    toolId,
    displayName: sanitizeString(source.displayName, toolId).slice(0, 120) || toolId,
    command,
    reason: sanitizeString(source.reason).slice(0, 1000),
    permissions: sanitizeHostToolPermissions(source.permissions),
    channel: sanitizeString(source.channel).slice(0, 80),
    chatId: sanitizeString(source.chatId).slice(0, 160),
    scopeId: sanitizeString(source.scopeId).slice(0, 200),
    requestedAt: sanitizeString(source.requestedAt, new Date().toISOString()),
    approvalMode,
    status,
    resolvedAt: source.resolvedAt ? sanitizeString(source.resolvedAt) : undefined,
    pendingAction: sanitizeHostToolPendingAction(source.pendingAction)
  };
}

function sanitizeApprovedTool(input: unknown): ApprovedHostTool | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const toolId = sanitizeHostToolId(source.toolId);
  const command = sanitizeHostCommand(source.command);
  if (!toolId || !command) return null;
  return {
    toolId,
    displayName: sanitizeString(source.displayName, toolId).slice(0, 120) || toolId,
    command,
    reason: sanitizeString(source.reason).slice(0, 1000),
    permissions: sanitizeHostToolPermissions(source.permissions),
    approvedAt: sanitizeString(source.approvedAt, new Date().toISOString()),
    approvedFromRequestId: sanitizeString(source.approvedFromRequestId).slice(0, 80),
    channel: sanitizeString(source.channel).slice(0, 80),
    chatId: sanitizeString(source.chatId).slice(0, 160),
    scopeId: sanitizeString(source.scopeId).slice(0, 200),
    enabled: source.enabled === undefined ? true : Boolean(source.enabled)
  };
}

export function sanitizeHostToolSettings(input: unknown): HostToolSettings {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const approvals = Array.isArray(source.pendingApprovals) ? source.pendingApprovals : [];
  const history = Array.isArray(source.approvalHistory) ? source.approvalHistory : [];
  const approved = Array.isArray(source.approvedTools) ? source.approvedTools : [];
  const allApprovals = [...approvals, ...history]
    .map(sanitizeApproval)
    .filter((item): item is HostToolApprovalRequest => Boolean(item));
  const pendingApprovals = allApprovals.filter((item) => item.status === "pending");
  const approvalHistory = allApprovals.filter((item) => item.status !== "pending");
  const approvedTools: ApprovedHostTool[] = [];
  const seenApproved = new Set<string>();
  for (const item of approved.map(sanitizeApprovedTool)) {
    if (!item || seenApproved.has(item.toolId)) continue;
    seenApproved.add(item.toolId);
    approvedTools.push(item);
  }
  return { pendingApprovals, approvalHistory, approvedTools };
}

export function findPendingHostToolApproval(
  settings: HostToolSettings,
  scopeId: string,
  approvalId?: string
): HostToolApprovalRequest | null {
  const pending = settings.pendingApprovals.filter((item) => item.status === "pending" && item.scopeId === scopeId);
  if (approvalId) return pending.find((item) => item.id === approvalId) ?? null;
  return pending.length === 1 ? pending[0] : null;
}

export function approveHostToolRequest(
  settings: HostToolSettings,
  scopeId: string,
  approvalId?: string,
  options?: { persistApprovedTool?: boolean }
): { settings: HostToolSettings; approved?: ApprovedHostTool; request: HostToolApprovalRequest } | null {
  const pending = findPendingHostToolApproval(settings, scopeId, approvalId);
  if (!pending) return null;
  const persistApprovedTool = options?.persistApprovedTool ?? true;
  const now = new Date().toISOString();
  const resolvedPending = { ...pending, status: "approved" as const, resolvedAt: now };
  const nextPending = settings.pendingApprovals.filter((item) => item.id !== pending.id);
  if (pending.approvalMode === "ephemeral" || !persistApprovedTool) {
    return {
      settings: {
        pendingApprovals: nextPending,
        approvalHistory: [resolvedPending, ...settings.approvalHistory],
        approvedTools: settings.approvedTools
      },
      request: pending
    };
  }
  const approved: ApprovedHostTool = {
    toolId: pending.toolId,
    displayName: pending.displayName,
    command: pending.command,
    reason: pending.reason,
    permissions: pending.permissions,
    approvedAt: now,
    approvedFromRequestId: pending.id,
    channel: pending.channel,
    chatId: pending.chatId,
    scopeId: pending.scopeId,
    enabled: true
  };
  const approvedTools = [
    approved,
    ...settings.approvedTools.filter((item) => item.toolId !== approved.toolId)
  ];
  return {
    settings: {
      pendingApprovals: nextPending,
      approvalHistory: [resolvedPending, ...settings.approvalHistory],
      approvedTools
    },
    approved,
    request: pending
  };
}

export function requestHostToolApproval(
  settings: HostToolSettings,
  input: {
    toolId?: unknown;
    displayName?: unknown;
    command: unknown;
    reason: unknown;
    approvalMode?: unknown;
    permissions?: unknown;
    pendingAction?: unknown;
    channel: unknown;
    chatId: unknown;
    scopeId: unknown;
  }
): {
  kind: "created" | "existing-pending" | "existing-approved";
  settings: HostToolSettings;
  approval?: HostToolApprovalRequest;
  approved?: ApprovedHostTool;
} {
  const command = sanitizeHostCommand(input.command);
  const toolId = sanitizeHostToolId(input.toolId ?? command);
  const approvalModeRaw = sanitizeString(input.approvalMode);
  const approvalMode: HostToolApprovalMode = approvalModeRaw === "ephemeral" ? "ephemeral" : "persistent";
  const reason = sanitizeString(input.reason).slice(0, 1000);
  const channel = sanitizeString(input.channel).slice(0, 80);
  const chatId = sanitizeString(input.chatId).slice(0, 160);
  const scopeId = sanitizeString(input.scopeId).slice(0, 200);
  const displayName = sanitizeString(input.displayName, toolId || command).slice(0, 120) || toolId || command;
  const pendingAction = sanitizeHostToolPendingAction(input.pendingAction);
  const effectiveCommand = approvalMode === "ephemeral"
    ? sanitizeString(input.command).slice(0, 240)
    : command;
  if (!effectiveCommand) {
    const rawCommand = sanitizeString(input.command);
    throw new Error(
      rawCommand && isForbiddenHostCommand(rawCommand)
        ? `Host tool command is not allowed: ${rawCommand}`
        : "command is required for host tool approval requests."
    );
  }
  if (!toolId) throw new Error("toolId is required for host tool approval requests.");
  if (!reason) throw new Error("reason is required for host tool approval requests.");

  if (approvalMode === "persistent") {
    const existingApproved = settings.approvedTools.find((item) => item.toolId === toolId && item.enabled);
    if (existingApproved) {
      return {
        kind: "existing-approved",
        settings,
        approved: existingApproved
      };
    }
  }

  const existingPending = settings.pendingApprovals.find((item) =>
    item.status === "pending" &&
    item.scopeId === scopeId &&
    (
      approvalMode === "persistent"
        ? item.toolId === toolId && item.approvalMode === "persistent"
        : item.approvalMode === "ephemeral" && item.pendingAction?.originalCommand === pendingAction?.originalCommand
    )
  );
  if (existingPending) {
    return {
      kind: "existing-pending",
      settings,
      approval: existingPending
    };
  }

  const request: HostToolApprovalRequest = {
    id: buildApprovalId(toolId),
    toolId,
    displayName,
    command: effectiveCommand,
    reason,
    permissions: sanitizeHostToolPermissions(input.permissions),
    channel,
    chatId,
    scopeId,
    requestedAt: new Date().toISOString(),
    approvalMode,
    status: "pending",
    pendingAction
  };

  return {
      kind: "created",
      settings: {
        pendingApprovals: [request, ...settings.pendingApprovals],
        approvalHistory: settings.approvalHistory,
        approvedTools: settings.approvedTools
      },
      approval: request
  };
}
