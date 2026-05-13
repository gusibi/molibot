import type {
  ApprovedHostTool,
  HostToolApprovalRequest,
  HostToolFilesystemAccess,
  HostToolNetworkAccess,
  HostToolPendingAction,
  HostToolPermissions,
  HostToolSettings
} from "./schema.js";

export const defaultHostToolPermissions: HostToolPermissions = {
  envAllowlist: [],
  filesystem: "scratch-only",
  network: "none"
};

export const defaultHostToolSettings: HostToolSettings = {
  pendingApprovals: [],
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
  if (kind !== "run_approved_host_tool") return undefined;
  const originalCommand = sanitizeString(source.originalCommand).slice(0, 4000);
  const args = sanitizeArgList(source.args);
  const stdin = sanitizeOptionalString(source.stdin, 20000);
  const timeoutRaw = Number(source.timeout);
  const timeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.min(Math.round(timeoutRaw), 600) : undefined;
  return {
    kind: "run_approved_host_tool",
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
    id: "approve" | "reject";
    label: string;
    style: "primary" | "danger";
  }>;
  request: {
    toolId: string;
    displayName: string;
    command: string;
    args: string[];
    reason: string;
    permissions: HostToolPermissions;
    requestedAt: string;
  };
}

export function buildHostToolApprovalPrompt(request: HostToolApprovalRequest): HostToolApprovalPrompt {
  return {
    type: "host_tool_approval",
    requestId: request.id,
    title: `Host tool approval: ${request.displayName}`,
    body: [
      `Tool ID: ${request.toolId}`,
      `Command: ${request.command}`,
      request.pendingAction?.args?.length ? `Args: ${request.pendingAction.args.join(" ")}` : "",
      `Reason: ${request.reason}`,
      `Permissions: filesystem=${request.permissions.filesystem}, network=${request.permissions.network}, env=${request.permissions.envAllowlist.join(", ") || "(none)"}`
    ].filter(Boolean).join("\n"),
    options: [
      { id: "approve", label: "Approve", style: "primary" },
      { id: "reject", label: "Reject", style: "danger" }
    ],
    request: {
      toolId: request.toolId,
      displayName: request.displayName,
      command: request.command,
      args: request.pendingAction?.args ?? [],
      reason: request.reason,
      permissions: request.permissions,
      requestedAt: request.requestedAt
    }
  };
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

function sanitizeApproval(input: unknown): HostToolApprovalRequest | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const id = sanitizeString(source.id).slice(0, 80);
  const toolId = sanitizeHostToolId(source.toolId);
  const command = sanitizeHostCommand(source.command);
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
  const approved = Array.isArray(source.approvedTools) ? source.approvedTools : [];
  const pendingApprovals = approvals
    .map(sanitizeApproval)
    .filter((item): item is HostToolApprovalRequest => Boolean(item));
  const approvedTools: ApprovedHostTool[] = [];
  const seenApproved = new Set<string>();
  for (const item of approved.map(sanitizeApprovedTool)) {
    if (!item || seenApproved.has(item.toolId)) continue;
    seenApproved.add(item.toolId);
    approvedTools.push(item);
  }
  return { pendingApprovals, approvedTools };
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
  approvalId?: string
): { settings: HostToolSettings; approved: ApprovedHostTool; request: HostToolApprovalRequest } | null {
  const pending = findPendingHostToolApproval(settings, scopeId, approvalId);
  if (!pending) return null;
  const now = new Date().toISOString();
  const nextPending = settings.pendingApprovals.map((item) =>
    item.id === pending.id ? { ...item, status: "approved" as const, resolvedAt: now } : item
  );
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
  return { settings: { pendingApprovals: nextPending, approvedTools }, approved, request: pending };
}

export function requestHostToolApproval(
  settings: HostToolSettings,
  input: {
    toolId?: unknown;
    displayName?: unknown;
    command: unknown;
    reason: unknown;
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
  const reason = sanitizeString(input.reason).slice(0, 1000);
  const channel = sanitizeString(input.channel).slice(0, 80);
  const chatId = sanitizeString(input.chatId).slice(0, 160);
  const scopeId = sanitizeString(input.scopeId).slice(0, 200);
  const displayName = sanitizeString(input.displayName, toolId || command).slice(0, 120) || toolId || command;
  if (!command) {
    const rawCommand = sanitizeString(input.command);
    throw new Error(
      rawCommand && isForbiddenHostCommand(rawCommand)
        ? `Host tool command is not allowed: ${rawCommand}`
        : "command is required for host tool approval requests."
    );
  }
  if (!toolId) throw new Error("toolId is required for host tool approval requests.");
  if (!reason) throw new Error("reason is required for host tool approval requests.");

  const existingApproved = settings.approvedTools.find((item) => item.toolId === toolId && item.enabled);
  if (existingApproved) {
    return {
      kind: "existing-approved",
      settings,
      approved: existingApproved
    };
  }

  const existingPending = settings.pendingApprovals.find((item) =>
    item.status === "pending" && item.scopeId === scopeId && item.toolId === toolId
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
    command,
    reason,
    permissions: sanitizeHostToolPermissions(input.permissions),
    channel,
    chatId,
    scopeId,
    requestedAt: new Date().toISOString(),
    status: "pending",
    pendingAction: sanitizeHostToolPendingAction(input.pendingAction)
  };

  return {
    kind: "created",
    settings: {
      pendingApprovals: [request, ...settings.pendingApprovals],
      approvedTools: settings.approvedTools
    },
    approval: request
  };
}
