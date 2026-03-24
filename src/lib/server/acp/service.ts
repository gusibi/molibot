import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type {
  AcpApprovalMode,
  AcpProjectConfig,
  AcpTargetConfig,
  RuntimeSettings
} from "../settings/index.js";
import {
  buildAcpAuthHint,
  formatAcpAdapterLabel,
  formatProviderScopedCommands,
  resolveAcpProviderProfile
} from "./providers/index.js";
import { JsonRpcStdioConnection } from "./connection.js";
import type {
  AcpProgressEvent,
  AcpListedSession,
  AcpSessionsList,
  AcpPendingPermissionView,
  AcpPermissionOption,
  AcpPromptResult,
  AcpSessionSummary,
  AcpTaskCallbacks,
  AcpToolCallSnapshot,
  JsonRpcNotification,
  JsonRpcRequest
} from "./types.js";

interface AcpPermissionDecision {
  outcome: "selected" | "cancelled";
  optionId?: string;
}

interface PendingPermission {
  id: string;
  sessionId: string;
  title: string;
  kind: string;
  options: AcpPermissionOption[];
  rawInput?: unknown;
  createdAt: string;
  resolve: (decision: AcpPermissionDecision) => void;
}

interface ActiveRunState {
  prompt: string;
  assistantText: string;
  lastStatus: string;
  toolCalls: Map<string, AcpToolCallSnapshot>;
  callbacks: AcpTaskCallbacks;
  startedAt: string;
}

interface ActiveChatSession {
  remoteSessionId: string;
  title: string;
  target: AcpTargetConfig;
  project: AcpProjectConfig;
  approvalMode: AcpApprovalMode;
  running: boolean;
  lastStatus: string;
  lastStopReason?: string;
  lastError?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  availableCommands: string[];
  pendingPermissions: Map<string, PendingPermission>;
  run: ActiveRunState | null;
  client: AcpAgentClient;
}

interface PermissionRequestPayload {
  requestId: string;
  sessionId: string;
  title: string;
  kind: string;
  rawInput?: unknown;
  options: AcpPermissionOption[];
}

interface PersistedChatSession {
  remoteSessionId: string;
  targetId: string;
  projectId: string;
  approvalMode: AcpApprovalMode;
  title: string;
  projectPath: string;
  lastStatus: string;
  lastStopReason?: string;
  lastError?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
}

type PersistedAcpState = Record<string, PersistedChatSession>;

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarize(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

async function emitProgress(
  callbacks: AcpTaskCallbacks,
  event: AcpProgressEvent
): Promise<void> {
  if (!callbacks.onProgress) return;
  await callbacks.onProgress(event);
}

function summarizeToolCalls(toolCalls: AcpToolCallSnapshot[]): string[] {
  if (toolCalls.length === 0) return [];
  const completed = toolCalls.filter((tool) => tool.status === "completed");
  const failed = toolCalls.filter((tool) => tool.status === "failed");
  const uniqueTitles = Array.from(
    new Set(
      completed
        .map((tool) => tool.title.trim())
        .filter((title) => title && !/^call_[a-z0-9]+$/i.test(title))
    )
  );
  const uniqueLocations = Array.from(
    new Set(
      completed
        .flatMap((tool) => tool.locations)
        .map((location) => location.trim())
        .filter(Boolean)
    )
  );

  const lines = [`Tools completed: ${completed.length}/${toolCalls.length}`];
  if (failed.length > 0) {
    lines.push(`Tools failed: ${failed.length}`);
  }
  if (uniqueTitles.length > 0) {
    lines.push(`Key actions: ${uniqueTitles.slice(0, 5).join(", ")}`);
  }
  if (uniqueLocations.length > 0) {
    lines.push(`Touched: ${uniqueLocations.slice(0, 8).join(", ")}`);
  }
  return lines;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function normalizePermissionOptions(input: unknown): AcpPermissionOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const optionId = String(item.optionId ?? item.id ?? "").trim();
      if (!optionId) return null;
      return {
        optionId,
        name: String(item.name ?? item.title ?? optionId).trim() || optionId,
        kind: String(item.kind ?? "").trim(),
        description: String(item.description ?? item.summary ?? "").trim()
      };
    })
    .filter(Boolean) as AcpPermissionOption[];
}

function selectAllowOption(options: AcpPermissionOption[]): AcpPermissionOption | null {
  const allowAlways = options.find((option) => /always|forever|all/i.test(option.optionId) || /always|forever|all/i.test(option.kind));
  if (allowAlways) return allowAlways;
  const allowOnce = options.find((option) => /once|allow|yes|approve/i.test(option.optionId) || /allow|approve|yes/i.test(option.kind));
  if (allowOnce) return allowOnce;
  return options[0] ?? null;
}

function selectDenyOption(options: AcpPermissionOption[]): AcpPermissionOption | null {
  return options.find((option) => /deny|reject|cancel|block|no/i.test(`${option.optionId} ${option.kind} ${option.name}`)) ?? null;
}

function isAutoSafeInput(kind: string, rawInput: unknown): boolean {
  const text = `${kind} ${stringifyUnknown(rawInput)}`.toLowerCase();
  if (/write|edit|delete|remove|install|network|push|commit|deploy|apply/.test(text)) {
    return false;
  }
  return [
    /\bgit status\b/,
    /\bgit diff\b/,
    /\brg\b/,
    /\bcat\b/,
    /\bsed\b/,
    /\bfind\b/,
    /\bls\b/,
    /\bpwd\b/,
    /\bnpm test\b/,
    /\bpnpm test\b/,
    /\byarn test\b/,
    /\bvitest\b/,
    /\bpytest\b/,
    /\bgo test\b/,
    /\bcargo test\b/
  ].some((pattern) => pattern.test(text));
}

function parseSessionUpdate(params: unknown): { sessionId: string; updateType: string; update: Record<string, unknown> } | null {
  if (!params || typeof params !== "object") return null;
  const envelope = params as Record<string, unknown>;
  const sessionId = String(envelope.sessionId ?? envelope.session_id ?? "").trim();
  const update = envelope.update && typeof envelope.update === "object"
    ? envelope.update as Record<string, unknown>
    : envelope;
  const updateType = String(update.sessionUpdate ?? update.type ?? update.updateType ?? "").trim();
  if (!sessionId) return null;
  return { sessionId, updateType, update };
}

function parsePermissionRequest(requestId: string, params: unknown): PermissionRequestPayload | null {
  if (!params || typeof params !== "object") return null;
  const envelope = params as Record<string, unknown>;
  const payload = envelope.request && typeof envelope.request === "object"
    ? envelope.request as Record<string, unknown>
    : envelope;
  const sessionId = String(payload.sessionId ?? envelope.sessionId ?? payload.session_id ?? "").trim();
  const toolCall = payload.toolCall && typeof payload.toolCall === "object"
    ? payload.toolCall as Record<string, unknown>
    : payload.tool_call && typeof payload.tool_call === "object"
      ? payload.tool_call as Record<string, unknown>
      : {};
  const title = String(toolCall.title ?? payload.title ?? toolCall.description ?? toolCall.kind ?? "Permission request").trim() || "Permission request";
  const kind = String(toolCall.kind ?? payload.kind ?? "").trim() || "permission";
  const rawInput = toolCall.rawInput ?? toolCall.raw_input ?? payload.rawInput;
  const options = normalizePermissionOptions(payload.options ?? envelope.options);
  if (!sessionId) return null;
  return {
    requestId,
    sessionId,
    title,
    kind,
    rawInput,
    options
  };
}

function parseToolCall(update: Record<string, unknown>): AcpToolCallSnapshot | null {
  const toolCall = update.toolCall && typeof update.toolCall === "object"
    ? update.toolCall as Record<string, unknown>
    : update.tool_call && typeof update.tool_call === "object"
      ? update.tool_call as Record<string, unknown>
      : update;
  const id = String(toolCall.toolCallId ?? toolCall.id ?? update.toolCallId ?? randomUUID()).trim();
  const title = String(toolCall.title ?? toolCall.description ?? toolCall.kind ?? id).trim() || id;
  const kind = String(toolCall.kind ?? update.kind ?? "tool").trim() || "tool";
  const status = String(update.status ?? toolCall.status ?? "pending").trim() || "pending";
  const rawLocations = Array.isArray(toolCall.locations) ? toolCall.locations : Array.isArray(update.locations) ? update.locations : [];
  const locations = rawLocations.map((value) => String(value ?? "").trim()).filter(Boolean);
  return {
    id,
    title,
    kind,
    status,
    locations,
    rawInput: toolCall.rawInput ?? toolCall.raw_input,
    rawOutput: toolCall.rawOutput ?? toolCall.raw_output
  };
}

function normalizeAvailableCommands(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => {
      if (typeof value === "string") {
        return value.trim();
      }
      if (value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        return String(row.name ?? row.id ?? row.command ?? "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function parseRemoteCommandToken(raw: string): { namespace?: string; command: string; args: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { command: "", args: "" };
  }
  const firstSpace = trimmed.indexOf(" ");
  const token = firstSpace >= 0 ? trimmed.slice(0, firstSpace).trim() : trimmed;
  const args = firstSpace >= 0 ? trimmed.slice(firstSpace + 1).trim() : "";
  const scoped = token.match(/^([a-z0-9-]+):(.*)$/i);
  if (!scoped) {
    return { command: token, args };
  }
  return {
    namespace: scoped[1]?.trim().toLowerCase(),
    command: String(scoped[2] ?? "").trim(),
    args
  };
}

function normalizeCommandKey(value: string): string {
  return value.trim().toLowerCase();
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function normalizeListedSessions(input: unknown): AcpListedSession[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const sessionId = String(row.sessionId ?? row.session_id ?? "").trim();
      if (!sessionId) return null;
      return {
        sessionId,
        cwd: String(row.cwd ?? "").trim(),
        title: String(row.title ?? "").trim() || sessionId,
        updatedAt: String(row.updatedAt ?? row.updated_at ?? "").trim() || undefined
      } satisfies AcpListedSession;
    })
    .filter(Boolean) as AcpListedSession[];
}

function extractChunkText(update: Record<string, unknown>): string {
  const chunk = update.delta ?? update.text ?? update.content ?? update.message;
  if (typeof chunk === "string") return chunk;
  if (Array.isArray(chunk)) {
    return chunk
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return String((part as { text?: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  if (chunk && typeof chunk === "object" && typeof (chunk as { text?: unknown }).text === "string") {
    return String((chunk as { text?: unknown }).text);
  }
  return "";
}

class AcpAgentClient {
  private readonly connection: JsonRpcStdioConnection;
  private readonly stderrChunks: string[] = [];

  constructor(
    target: AcpTargetConfig,
    handlers: {
      onSessionUpdate: (sessionId: string, updateType: string, update: Record<string, unknown>) => Promise<void>;
      onPermissionRequest: (request: PermissionRequestPayload) => Promise<AcpPermissionDecision>;
      onStderr: (chunk: string) => void;
      onExit: () => void;
    }
  ) {
    this.connection = new JsonRpcStdioConnection(
      target.command,
      target.args,
      {
        cwd: target.cwd || undefined,
        env: target.env
      },
      {
        onRequest: async (request: JsonRpcRequest) => {
          if (request.method === "session/request_permission") {
            const payload = parsePermissionRequest(String(request.id), request.params);
            if (!payload) {
              return { outcome: "cancelled" };
            }
            return await handlers.onPermissionRequest(payload);
          }
          throw new Error(`Unsupported ACP request method: ${request.method}`);
        },
        onNotification: (notification: JsonRpcNotification) => {
          if (notification.method !== "session/update") return;
          const parsed = parseSessionUpdate(notification.params);
          if (!parsed) return;
          void handlers.onSessionUpdate(parsed.sessionId, parsed.updateType, parsed.update);
        },
        onStderr: (chunk) => {
          const text = chunk.trim();
          if (text) {
            this.stderrChunks.push(text);
            if (this.stderrChunks.length > 8) {
              this.stderrChunks.shift();
            }
          }
          handlers.onStderr(chunk);
        },
        onExit: () => handlers.onExit()
      }
    );
  }

  async initialize(): Promise<void> {
    await this.connection.sendRequest("initialize", {
      protocolVersion: 1,
      clientInfo: {
        name: "molibot",
        version: "0.1.0"
      },
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false
        },
        terminal: false
      }
    });
  }

  async createSession(projectPath: string): Promise<{ sessionId: string; title: string; availableCommands: string[] }> {
    const result = await this.connection.sendRequest<Record<string, unknown>>("session/new", {
      cwd: projectPath,
      mcpServers: []
    });
    return {
      sessionId: String(result.sessionId ?? result.session_id ?? "").trim(),
      title: String(result.title ?? "").trim(),
      availableCommands: normalizeAvailableCommands(result.availableCommands)
    };
  }

  async loadSession(sessionId: string, projectPath: string): Promise<{ availableCommands: string[]; title?: string }> {
    const result = await this.connection.sendRequest<Record<string, unknown>>("session/load", {
      sessionId,
      cwd: projectPath,
      mcpServers: []
    });
    return {
      title: String(result.title ?? "").trim() || undefined,
      availableCommands: normalizeAvailableCommands(result.availableCommands)
    };
  }

  async listSessions(): Promise<AcpListedSession[]> {
    const result = await this.connection.sendRequest<Record<string, unknown>>("session/list", {});
    return normalizeListedSessions(result.sessions);
  }

  async prompt(sessionId: string, prompt: string): Promise<{ stopReason: string }> {
    const result = await this.connection.sendRequest<Record<string, unknown>>("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }]
    });
    return {
      stopReason: String(result.stopReason ?? result.stop_reason ?? result.status ?? "completed").trim() || "completed"
    };
  }

  async cancel(sessionId: string): Promise<void> {
    this.connection.sendNotification("session/cancel", { sessionId });
  }

  close(): void {
    this.connection.close();
  }

  getRecentStderr(): string {
    return this.stderrChunks.join("\n").trim();
  }
}

export class AcpService {
  private readonly chats = new Map<string, ActiveChatSession>();
  private readonly stateFilePath?: string;
  private readonly persisted = new Map<string, PersistedChatSession>();

  constructor(
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    options?: { stateFilePath?: string }
  ) {
    this.stateFilePath = options?.stateFilePath;
    this.loadPersistedState();
  }

  listTargets(): AcpTargetConfig[] {
    return [...(this.getSettings().acp.targets ?? [])];
  }

  listProjects(): AcpProjectConfig[] {
    return [...(this.getSettings().acp.projects ?? [])];
  }

  async listSessions(chatKey: string): Promise<AcpSessionsList> {
    const active = this.chats.get(chatKey);
    const saved = this.persisted.get(chatKey);
    const settings = this.getSettings().acp;

    const targetId = active?.target.id ?? saved?.targetId ?? settings.targets.find((target) => target.enabled)?.id ?? "";
    if (!targetId) {
      throw new Error("No enabled ACP target is available.");
    }
    const target = settings.targets.find((item) => item.id === targetId && item.enabled);
    if (!target) {
      throw new Error(`Unknown or disabled ACP target: ${targetId}`);
    }

    const projectId = active?.project.id ?? saved?.projectId;
    const project = projectId ? settings.projects.find((item) => item.id === projectId) : undefined;
    const projectPath = project?.path ? resolve(project.path) : active?.project.path ?? saved?.projectPath ?? "";
    const currentSessionId = active?.remoteSessionId ?? saved?.remoteSessionId;

    const client = new AcpAgentClient(target, {
      onSessionUpdate: async () => undefined,
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      onStderr: () => undefined,
      onExit: () => undefined
    });

    try {
      await withTimeout(client.initialize(), 30000, "ACP initialize");
      let sessions = await withTimeout(client.listSessions(), 30000, "ACP session/list");
      if (projectPath) {
        sessions = sessions.filter((session) => resolve(session.cwd || "") === projectPath);
      }
      sessions.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      return {
        targetId,
        projectId,
        currentSessionId,
        sessions
      };
    } finally {
      client.close();
    }
  }

  async restoreSession(chatKey: string): Promise<AcpSessionSummary | null> {
    const active = this.chats.get(chatKey);
    if (active) return this.getStatus(chatKey);

    const persisted = this.persisted.get(chatKey);
    if (!persisted) return null;

    const settings = this.getSettings().acp;
    if (!settings.enabled) {
      throw new Error("ACP is disabled in runtime settings.");
    }
    const target = settings.targets.find((item) => item.id === persisted.targetId && item.enabled);
    if (!target) {
      this.clearPersistedSession(chatKey);
      throw new Error(`Saved ACP target is unavailable: ${persisted.targetId}`);
    }
    const project = settings.projects.find((item) => item.id === persisted.projectId && item.enabled);
    if (!project) {
      this.clearPersistedSession(chatKey);
      throw new Error(`Saved ACP project is unavailable: ${persisted.projectId}`);
    }
    const projectPath = resolve(project.path || persisted.projectPath);
    if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
      this.clearPersistedSession(chatKey);
      throw new Error(`Saved ACP project path is not a directory: ${projectPath}`);
    }

    const client = new AcpAgentClient(target, {
      onSessionUpdate: async (sessionId, updateType, update) => {
        await this.handleSessionUpdate(chatKey, sessionId, updateType, update);
      },
      onPermissionRequest: async (request) => await this.handlePermissionRequest(chatKey, request),
      onStderr: (chunk) => {
        const restored = this.chats.get(chatKey);
        const text = summarize(chunk, 240);
        if (!restored || !text) return;
        restored.lastStatus = `Adapter stderr: ${text}`;
        if (restored.run) {
          restored.run.lastStatus = restored.lastStatus;
          void restored.run.callbacks.onStatus(restored.lastStatus);
        }
        this.persistSessionState(chatKey, restored);
      },
      onExit: () => {
        const restored = this.chats.get(chatKey);
        if (!restored) return;
        restored.running = false;
        restored.lastError = "ACP adapter exited";
        restored.lastStatus = "ACP adapter exited";
        const pending = [...restored.pendingPermissions.values()];
        restored.pendingPermissions.clear();
        for (const permission of pending) {
          permission.resolve({ outcome: "cancelled" });
        }
        this.persistSessionState(chatKey, restored);
      }
    });

    try {
      await withTimeout(client.initialize(), 30000, "ACP initialize");
      const loaded = await withTimeout(client.loadSession(persisted.remoteSessionId, projectPath), 60000, "ACP session/load");
      const restored: ActiveChatSession = {
        remoteSessionId: persisted.remoteSessionId,
        title: loaded.title || persisted.title || `${target.id}:${project.id}`,
        target,
        project: { ...project, path: projectPath },
        approvalMode: persisted.approvalMode ?? project.defaultApprovalMode ?? "manual",
        running: false,
        lastStatus: persisted.lastStatus || "Session restored",
        lastStopReason: persisted.lastStopReason,
        lastError: persisted.lastError,
        lastStartedAt: persisted.lastStartedAt,
        lastFinishedAt: persisted.lastFinishedAt,
        availableCommands: loaded.availableCommands,
        pendingPermissions: new Map(),
        run: null,
        client
      };
      this.chats.set(chatKey, restored);
      this.persistSessionState(chatKey, restored);
      return this.getStatus(chatKey);
    } catch (error) {
      client.close();
      this.clearPersistedSession(chatKey);
      throw new Error(
        `Saved ACP session could not be restored. Run /acp new <target> <project> first.\n${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async openSession(chatKey: string, targetId: string, projectId: string, approvalMode?: AcpApprovalMode): Promise<AcpSessionSummary> {
    await this.closeSession(chatKey);

    const settings = this.getSettings().acp;
    if (!settings.enabled) {
      throw new Error("ACP is disabled in runtime settings.");
    }
    const target = settings.targets.find((item) => item.id === targetId && item.enabled);
    if (!target) {
      throw new Error(`Unknown or disabled ACP target: ${targetId}`);
    }

    const project = settings.projects.find((item) => item.id === projectId && item.enabled);
    if (!project) {
      throw new Error(`Unknown or disabled ACP project: ${projectId}`);
    }
    if (project.allowedTargetIds.length > 0 && !project.allowedTargetIds.includes(targetId)) {
      throw new Error(`Project '${projectId}' is not allowed to use target '${targetId}'.`);
    }

    const projectPath = resolve(project.path);
    if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
      throw new Error(`Project path is not a directory: ${projectPath}`);
    }

    const client = new AcpAgentClient(target, {
      onSessionUpdate: async (sessionId, updateType, update) => {
        await this.handleSessionUpdate(chatKey, sessionId, updateType, update);
      },
      onPermissionRequest: async (request) => await this.handlePermissionRequest(chatKey, request),
      onStderr: (chunk) => {
        const active = this.chats.get(chatKey);
        if (!active?.run) return;
        const text = summarize(chunk, 240);
        if (!text) return;
        active.run.lastStatus = `Adapter stderr: ${text}`;
        void active.run.callbacks.onStatus(active.run.lastStatus);
      },
      onExit: () => {
        const active = this.chats.get(chatKey);
        if (!active) return;
        active.running = false;
        active.lastError = "ACP adapter exited";
        active.lastStatus = "ACP adapter exited";
        const pending = [...active.pendingPermissions.values()];
        active.pendingPermissions.clear();
        for (const permission of pending) {
          permission.resolve({ outcome: "cancelled" });
        }
      }
    });

    let created: { sessionId: string; title: string; availableCommands: string[] };
    try {
      await withTimeout(client.initialize(), 30000, "ACP initialize");
      created = await withTimeout(client.createSession(projectPath), 60000, "ACP session/new");
    } catch (error) {
      const stderrTail = summarize(client.getRecentStderr(), 500);
      client.close();
      const baseMessage = error instanceof Error ? error.message : String(error);
      const authHint = buildAcpAuthHint(target);
      throw new Error(
        stderrTail
          ? `${baseMessage}\nAdapter stderr: ${stderrTail}${authHint ? `\n${authHint}` : ""}`
          : `${baseMessage}\nAdapter may still be installing, waiting for auth, or failing before replying.${authHint ? `\n${authHint}` : ""}`
      );
    }

    if (!created.sessionId) {
      client.close();
      throw new Error("ACP adapter did not return a sessionId.");
    }

    const active: ActiveChatSession = {
      remoteSessionId: created.sessionId,
      title: created.title || `${target.id}:${project.id}`,
      target,
      project: { ...project, path: projectPath },
      approvalMode: approvalMode ?? project.defaultApprovalMode ?? "manual",
      running: false,
      lastStatus: "Session ready",
      availableCommands: created.availableCommands,
      pendingPermissions: new Map(),
      run: null,
      client
    };
    this.chats.set(chatKey, active);
    this.persistSessionState(chatKey, active);
    return this.getStatus(chatKey)!;
  }

  async closeSession(chatKey: string): Promise<boolean> {
    const active = this.chats.get(chatKey);
    if (!active) {
      const hadPersisted = this.persisted.has(chatKey);
      if (hadPersisted) {
        this.clearPersistedSession(chatKey);
      }
      return hadPersisted;
    }
    if (active.running) {
      await active.client.cancel(active.remoteSessionId);
    }
    const pending = [...active.pendingPermissions.values()];
    active.pendingPermissions.clear();
    for (const permission of pending) {
      permission.resolve({ outcome: "cancelled" });
    }
    active.client.close();
    this.chats.delete(chatKey);
    this.clearPersistedSession(chatKey);
    return true;
  }

  getStatus(chatKey: string): AcpSessionSummary | null {
    const active = this.chats.get(chatKey);
    if (!active) return null;
    return {
      adapter: active.target.adapter,
      targetId: active.target.id,
      projectId: active.project.id,
      projectPath: active.project.path,
      remoteSessionId: active.remoteSessionId,
      approvalMode: active.approvalMode,
      title: active.title,
      running: active.running,
      lastStatus: active.lastStatus,
      lastStopReason: active.lastStopReason,
      lastError: active.lastError,
      lastStartedAt: active.lastStartedAt,
      lastFinishedAt: active.lastFinishedAt,
      availableCommands: [...active.availableCommands],
      pendingPermissions: [...active.pendingPermissions.values()].map((item): AcpPendingPermissionView => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        options: item.options,
        createdAt: item.createdAt,
        inputPreview: summarize(stringifyUnknown(item.rawInput), 300) || undefined
      }))
    };
  }

  getPendingPermission(chatKey: string, requestId: string): AcpPendingPermissionView | null {
    const active = this.chats.get(chatKey);
    const pending = active?.pendingPermissions.get(requestId);
    if (!pending) return null;
    return {
      id: pending.id,
      title: pending.title,
      kind: pending.kind,
      options: pending.options,
      createdAt: pending.createdAt,
      inputPreview: summarize(stringifyUnknown(pending.rawInput), 300) || undefined
    };
  }

  setApprovalMode(chatKey: string, mode: AcpApprovalMode): AcpSessionSummary {
    const active = this.requireSession(chatKey);
    active.approvalMode = mode;
    active.lastStatus = `Approval mode set to ${mode}`;
    this.persistSessionState(chatKey, active);
    return this.getStatus(chatKey)!;
  }

  resolveRemoteCommand(
    chatKey: string,
    rawInput: string
  ): { prompt: string; displayCommand: string } {
    const active = this.requireSession(chatKey);
    const profile = resolveAcpProviderProfile(active.target);
    const parsed = parseRemoteCommandToken(rawInput);
    if (!parsed.command) {
      throw new Error("Usage: /acp remote <command> [args]");
    }

    if (parsed.namespace) {
      const expected = profile?.commandNamespace ?? "";
      if (!expected || parsed.namespace !== expected) {
        const expectedLabel = expected ? `\`${expected}:/...\`` : "the active custom target";
        throw new Error(`Remote command prefix \`${parsed.namespace}:\` does not match ${expectedLabel}.`);
      }
    }

    const provided = parsed.command.trim();
    if (!provided) {
      throw new Error("Usage: /acp remote <command> [args]");
    }

    const available = [...active.availableCommands];
    let command = provided;
    if (available.length > 0) {
      const index = new Map<string, string>();
      for (const item of available) {
        const key = normalizeCommandKey(item);
        if (key) index.set(key, item);
        const withoutSlash = normalizeCommandKey(stripLeadingSlash(item));
        if (withoutSlash) index.set(withoutSlash, item);
      }
      const candidates = [normalizeCommandKey(provided), normalizeCommandKey(stripLeadingSlash(provided))]
        .filter(Boolean);
      const matched = candidates.map((key) => index.get(key)).find(Boolean);
      if (!matched) {
        const scopedCommands = formatProviderScopedCommands(active.target, available).slice(0, 20);
        throw new Error(
          [
            `Unknown remote command: ${provided}`,
            scopedCommands.length > 0
              ? `Available: ${scopedCommands.join(", ")}`
              : "No remote commands were reported by the active ACP session."
          ].join("\n")
        );
      }
      command = matched;
    }

    const prompt = parsed.args ? `${command} ${parsed.args}` : command;
    const display = parsed.args
      ? `${formatProviderScopedCommands(active.target, [command])[0] ?? command} ${parsed.args}`
      : (formatProviderScopedCommands(active.target, [command])[0] ?? command);
    return {
      prompt,
      displayCommand: display
    };
  }

  async runTask(chatKey: string, prompt: string, callbacks: AcpTaskCallbacks): Promise<AcpPromptResult> {
    const active = this.requireSession(chatKey);
    if (active.running || active.run) {
      throw new Error("An ACP task is already running in this chat.");
    }

    active.running = true;
    active.lastError = undefined;
    active.lastStopReason = undefined;
    active.lastStartedAt = new Date().toISOString();
    active.lastFinishedAt = undefined;
    active.lastStatus = `Starting: ${summarize(prompt, 120)}`;
    active.run = {
      prompt,
      assistantText: "",
      lastStatus: active.lastStatus,
      toolCalls: new Map(),
      callbacks,
      startedAt: active.lastStartedAt
    };
    await callbacks.onStatus(active.lastStatus);
    await emitProgress(callbacks, {
      type: "status_current",
      text: active.lastStatus
    });

    try {
      const result = await active.client.prompt(active.remoteSessionId, prompt);
      active.lastStopReason = result.stopReason;
      active.lastFinishedAt = new Date().toISOString();
      active.lastStatus = `Completed (${result.stopReason})`;
      this.persistSessionState(chatKey, active);
      await callbacks.onStatus(active.lastStatus);
      await emitProgress(callbacks, {
        type: "result",
        text: active.lastStatus,
        stopReason: result.stopReason
      });
      return {
        stopReason: result.stopReason,
        assistantText: active.run.assistantText.trim(),
        lastStatus: active.lastStatus,
        toolCalls: [...active.run.toolCalls.values()]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      active.lastError = message;
      active.lastFinishedAt = new Date().toISOString();
      active.lastStatus = `Failed: ${message}`;
      this.persistSessionState(chatKey, active);
      await callbacks.onStatus(active.lastStatus);
      await emitProgress(callbacks, {
        type: "result",
        text: active.lastStatus,
        stopReason: "failed"
      });
      throw error;
    } finally {
      active.running = false;
      active.run = null;
      this.persistSessionState(chatKey, active);
    }
  }

  async cancelRun(chatKey: string): Promise<boolean> {
    const active = this.chats.get(chatKey);
    if (!active?.running) return false;
    await active.client.cancel(active.remoteSessionId);
    active.lastStatus = "Cancellation requested";
    this.persistSessionState(chatKey, active);
    if (active.run) {
      await active.run.callbacks.onStatus(active.lastStatus);
      await emitProgress(active.run.callbacks, {
        type: "status_current",
        text: active.lastStatus
      });
    }
    return true;
  }

  async approve(chatKey: string, requestId: string, optionId: string): Promise<string> {
    return this.respondToPermission(chatKey, requestId, optionId, "Approved");
  }

  async respondToPermission(chatKey: string, requestId: string, optionId: string, verb = "Resolved"): Promise<string> {
    const active = this.requireSession(chatKey);
    const permission = active.pendingPermissions.get(requestId);
    if (!permission) {
      throw new Error(`No pending ACP permission request: ${requestId}`);
    }
    const option = permission.options.find((item) => item.optionId === optionId);
    if (!option) {
      throw new Error(`Unknown option '${optionId}' for request ${requestId}`);
    }
    active.pendingPermissions.delete(requestId);
    permission.resolve({ outcome: "selected", optionId: option.optionId });
    return `${verb} ${requestId} with option ${option.optionId}.`;
  }

  async deny(chatKey: string, requestId: string): Promise<string> {
    const active = this.requireSession(chatKey);
    const permission = active.pendingPermissions.get(requestId);
    if (!permission) {
      throw new Error(`No pending ACP permission request: ${requestId}`);
    }
    const denyOption = selectDenyOption(permission.options);
    active.pendingPermissions.delete(requestId);
    if (denyOption) {
      permission.resolve({ outcome: "selected", optionId: denyOption.optionId });
      return `Rejected ${requestId} with option ${denyOption.optionId}.`;
    }
    permission.resolve({ outcome: "cancelled" });
    return `Cancelled ${requestId}.`;
  }

  upsertProject(projectId: string, projectPath: string): AcpProjectConfig {
    const id = projectId.trim();
    if (!id) {
      throw new Error("Project id is required.");
    }
    const path = resolve(projectPath.trim());
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`Project path is not a directory: ${path}`);
    }

    const current = this.getSettings();
    const existing = current.acp.projects.find((item) => item.id === id);
    const defaultAllowedTargetIds = current.acp.targets
      .filter((item) => item.enabled)
      .map((item) => item.id);
    const nextProject: AcpProjectConfig = {
      id,
      name: existing?.name || id,
      enabled: true,
      path,
      allowedTargetIds: existing?.allowedTargetIds ?? defaultAllowedTargetIds,
      defaultApprovalMode: existing?.defaultApprovalMode ?? "manual"
    };
    const nextProjects = current.acp.projects.filter((item) => item.id !== id);
    nextProjects.push(nextProject);
    this.updateSettings({
      acp: {
        ...current.acp,
        projects: nextProjects.sort((a, b) => a.id.localeCompare(b.id))
      }
    });
    return nextProject;
  }

  removeProject(projectId: string): boolean {
    const id = projectId.trim();
    if (!id) return false;
    const current = this.getSettings();
    const nextProjects = current.acp.projects.filter((item) => item.id !== id);
    if (nextProjects.length === current.acp.projects.length) {
      return false;
    }
    this.updateSettings({
      acp: {
        ...current.acp,
        projects: nextProjects
      }
    });
    return true;
  }

  async dispose(): Promise<void> {
    for (const chatKey of [...this.chats.keys()]) {
      await this.closeSession(chatKey);
    }
  }

  private requireSession(chatKey: string): ActiveChatSession {
    const active = this.chats.get(chatKey);
    if (!active) {
      throw new Error("No active ACP session. Run /acp new <target> <project> first.");
    }
    return active;
  }

  private async handleSessionUpdate(
    chatKey: string,
    sessionId: string,
    updateType: string,
    update: Record<string, unknown>
  ): Promise<void> {
    const active = this.chats.get(chatKey);
    if (!active || active.remoteSessionId !== sessionId) return;

    switch (updateType) {
      case "agent_message_chunk": {
        if (!active.run) return;
        const chunk = extractChunkText(update);
        if (!chunk) return;
        active.run.assistantText += chunk;
        active.lastStatus = `Receiving output: ${summarize(active.run.assistantText, 240)}`;
        this.persistSessionState(chatKey, active);
        await active.run.callbacks.onStatus(active.lastStatus);
        await emitProgress(active.run.callbacks, {
          type: "assistant_output",
          text: active.lastStatus
        });
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        if (!active.run) return;
        const snapshot = parseToolCall(update);
        if (!snapshot) return;
        const previous = active.run.toolCalls.get(snapshot.id);
        active.run.toolCalls.set(snapshot.id, snapshot);
        active.lastStatus = `${snapshot.status}: ${snapshot.title}`;
        this.persistSessionState(chatKey, active);
        await active.run.callbacks.onStatus(active.lastStatus);
        const normalizedStatus = snapshot.status.trim().toLowerCase();
        if (normalizedStatus === "completed" && previous?.status !== snapshot.status) {
          await emitProgress(active.run.callbacks, {
            type: "step_completed",
            text: active.lastStatus,
            title: snapshot.title,
            locations: [...snapshot.locations]
          });
        } else if (normalizedStatus === "failed" && previous?.status !== snapshot.status) {
          await emitProgress(active.run.callbacks, {
            type: "step_failed",
            text: active.lastStatus,
            title: snapshot.title,
            locations: [...snapshot.locations]
          });
        } else {
          await emitProgress(active.run.callbacks, {
            type: "status_current",
            text: active.lastStatus
          });
        }
        return;
      }
      case "plan": {
        if (!active.run) return;
        const steps = Array.isArray(update.entries)
          ? update.entries.map((value) => summarize(stringifyUnknown(value), 120)).filter(Boolean)
          : [];
        if (steps.length === 0) return;
        {
          const text = `ACP plan:\n- ${steps.slice(0, 5).join("\n- ")}`;
          await active.run.callbacks.onEvent(text);
          await emitProgress(active.run.callbacks, {
            type: "plan",
            text
          });
        }
        return;
      }
      case "available_commands_update": {
        active.availableCommands = normalizeAvailableCommands(update.availableCommands);
        this.persistSessionState(chatKey, active);
        return;
      }
      case "session_info_update": {
        const title = String(update.title ?? "").trim();
        if (title) active.title = title;
        this.persistSessionState(chatKey, active);
        return;
      }
      case "current_mode_update": {
        const mode = String(update.mode ?? update.modeId ?? "").trim();
        if (!mode) return;
        active.lastStatus = `Remote mode: ${mode}`;
        this.persistSessionState(chatKey, active);
        if (active.run) {
          await active.run.callbacks.onEvent(active.lastStatus);
          await emitProgress(active.run.callbacks, {
            type: "status_current",
            text: active.lastStatus
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private async handlePermissionRequest(chatKey: string, request: PermissionRequestPayload): Promise<AcpPermissionDecision> {
    const active = this.chats.get(chatKey);
    if (!active || active.remoteSessionId !== request.sessionId) {
      return { outcome: "cancelled" };
    }

    const autoApproved = this.pickAutoDecision(active.approvalMode, request);
    if (autoApproved) {
      if (active.run) {
        const text = `ACP auto-approved: ${request.title}\nOption: ${autoApproved.optionId}`;
        await active.run.callbacks.onEvent(text);
        await emitProgress(active.run.callbacks, {
          type: "permission",
          text,
          permission: {
            id: request.requestId,
            title: request.title,
            kind: request.kind,
            options: request.options,
            createdAt: new Date().toISOString(),
            inputPreview: summarize(stringifyUnknown(request.rawInput), 300) || undefined
          }
        });
      }
      return { outcome: "selected", optionId: autoApproved.optionId };
    }

    return await new Promise<AcpPermissionDecision>(async (resolvePermission) => {
      const pending: PendingPermission = {
        id: request.requestId,
        sessionId: request.sessionId,
        title: request.title,
        kind: request.kind,
        options: request.options,
        rawInput: request.rawInput,
        createdAt: new Date().toISOString(),
        resolve: resolvePermission
      };
      active.pendingPermissions.set(request.requestId, pending);
      this.persistSessionState(chatKey, active);
      if (active.run?.callbacks.onPermissionRequest) {
        const permissionView = {
          id: pending.id,
          title: pending.title,
          kind: pending.kind,
          options: pending.options,
          createdAt: pending.createdAt,
          inputPreview: summarize(stringifyUnknown(pending.rawInput), 300) || undefined
        } satisfies AcpPendingPermissionView;
        await emitProgress(active.run.callbacks, {
          type: "permission",
          text: `ACP permission requested: ${pending.title}`,
          permission: permissionView
        });
        await active.run.callbacks.onPermissionRequest(permissionView);
      } else if (active.run) {
        const optionLines = request.options.length > 0
          ? request.options.map((option) => `- ${option.optionId}: ${option.name}${option.description ? ` (${option.description})` : ""}`).join("\n")
          : "- no options returned by adapter";
        const rawInput = summarize(stringifyUnknown(request.rawInput), 300);
        const text = [
          `ACP permission requested [${request.requestId}]`,
          `Title: ${request.title}`,
          `Kind: ${request.kind}`,
          rawInput ? `Input: ${rawInput}` : "",
          "Options:",
          optionLines,
          `Approve: /approve ${request.requestId} <optionId>`,
          `Deny: /deny ${request.requestId}`
        ].filter(Boolean).join("\n");
        await emitProgress(active.run.callbacks, {
          type: "permission",
          text,
          permission: {
            id: pending.id,
            title: pending.title,
            kind: pending.kind,
            options: pending.options,
            createdAt: pending.createdAt,
            inputPreview: summarize(stringifyUnknown(pending.rawInput), 300) || undefined
          }
        });
        await active.run.callbacks.onEvent(text);
      }
    });
  }

  private pickAutoDecision(mode: AcpApprovalMode, request: PermissionRequestPayload): AcpPermissionOption | null {
    if (mode === "manual") return null;
    if (mode === "auto-all") {
      return selectAllowOption(request.options);
    }
    if (mode === "auto-safe" && isAutoSafeInput(request.kind, request.rawInput)) {
      return selectAllowOption(request.options);
    }
    return null;
  }

  private loadPersistedState(): void {
    if (!this.stateFilePath || !existsSync(this.stateFilePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.stateFilePath, "utf8")) as PersistedAcpState;
      if (!parsed || typeof parsed !== "object") return;
      for (const [chatKey, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") continue;
        const row = value as PersistedChatSession;
        if (!row.remoteSessionId || !row.targetId || !row.projectId) continue;
        this.persisted.set(String(chatKey), row);
      }
    } catch {
      // ignore malformed persisted ACP state
    }
  }

  private savePersistedState(): void {
    if (!this.stateFilePath) return;
    const data = Object.fromEntries(this.persisted.entries());
    mkdirSync(dirname(this.stateFilePath), { recursive: true });
    writeFileSync(this.stateFilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  private persistSessionState(chatKey: string, session: ActiveChatSession): void {
    this.persisted.set(chatKey, {
      remoteSessionId: session.remoteSessionId,
      targetId: session.target.id,
      projectId: session.project.id,
      approvalMode: session.approvalMode,
      title: session.title,
      projectPath: session.project.path,
      lastStatus: session.lastStatus,
      lastStopReason: session.lastStopReason,
      lastError: session.lastError,
      lastStartedAt: session.lastStartedAt,
      lastFinishedAt: session.lastFinishedAt
    });
    this.savePersistedState();
  }

  private clearPersistedSession(chatKey: string): void {
    this.persisted.delete(chatKey);
    this.savePersistedState();
  }
}

export function formatAcpSessionSummary(summary: AcpSessionSummary | null): string {
  if (!summary) {
    return "No active ACP session.";
  }
  const adapterLabel = formatAcpAdapterLabel({
    adapter: summary.adapter,
    id: summary.targetId,
    name: summary.title,
    command: "",
    args: []
  });
  const lines = [
    `ACP session: ${summary.title}`,
    `Target: ${summary.targetId} (${adapterLabel})`,
    `Project: ${summary.projectId}`,
    `Path: ${summary.projectPath}`,
    `Remote session: ${summary.remoteSessionId}`,
    `Approval mode: ${summary.approvalMode}`,
    `Running: ${summary.running ? "yes" : "no"}`,
    `Last status: ${summary.lastStatus}`
  ];
  if (summary.lastStopReason) lines.push(`Last stop reason: ${summary.lastStopReason}`);
  if (summary.lastError) lines.push(`Last error: ${summary.lastError}`);
  if (summary.availableCommands.length > 0) {
    const scopedCommands = formatProviderScopedCommands(
      {
        adapter: summary.adapter,
        id: summary.targetId,
        name: summary.title,
        command: "",
        args: []
      },
      summary.availableCommands
    );
    lines.push(`Available commands: ${scopedCommands.join(", ")}`);
  }
  if (summary.pendingPermissions.length > 0) {
    lines.push("Pending permissions:");
    for (const permission of summary.pendingPermissions) {
      lines.push(`- ${permission.id}: ${permission.title} [${permission.kind}]`);
    }
  }
  return lines.join("\n");
}

export function formatAcpTargets(targets: AcpTargetConfig[]): string {
  if (targets.length === 0) {
    return "No ACP targets configured.";
  }
  return [
    "ACP targets:",
    ...targets.map((target) => {
      const adapterLabel = formatAcpAdapterLabel(target);
      return `- ${target.id}${target.enabled ? "" : " (disabled)"} [${adapterLabel}]: ${target.command} ${target.args.join(" ")}`.trim();
    })
  ].join("\n");
}

export function formatAcpProjects(projects: AcpProjectConfig[]): string {
  if (projects.length === 0) {
    return "No ACP projects configured. Add one with /acp add-project <id> <absolute-path>.";
  }
  return [
    "ACP projects:",
    ...projects.map((project) => `- ${project.id}${project.enabled ? "" : " (disabled)"}: ${project.path}`)
  ].join("\n");
}

export function formatAcpSessions(list: AcpSessionsList): string {
  const lines = [
    "ACP sessions:",
    `Target: ${list.targetId}`,
    list.projectId ? `Project: ${list.projectId}` : "",
    list.currentSessionId ? `Current: ${list.currentSessionId}` : ""
  ].filter(Boolean);

  if (list.sessions.length === 0) {
    lines.push("- no sessions found");
    return lines.join("\n");
  }

  for (const session of list.sessions.slice(0, 50)) {
    lines.push(
      `- ${session.sessionId}${session.sessionId === list.currentSessionId ? " (current)" : ""}` +
      `${session.updatedAt ? ` | ${session.updatedAt}` : ""}` +
      `${session.cwd ? ` | ${session.cwd}` : ""}`
    );
  }
  return lines.join("\n");
}
