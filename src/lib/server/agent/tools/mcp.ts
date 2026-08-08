import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { McpServerConfig } from "$lib/server/settings/schema.js";
import { spillFullOutput } from "$lib/server/agent/tools/outputSpill.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  sliceToBytes,
  truncateHead
} from "$lib/server/agent/tools/truncate.js";

export interface McpRegistryOptions {
  workspaceDir: string;
  onWarn?: (message: string, extra?: Record<string, unknown>) => void;
}

export type McpConnectionState = "disabled" | "connecting" | "connected" | "disconnected" | "error";

export interface McpServerStatus {
  serverId: string;
  state: McpConnectionState;
  toolCount: number;
  lastError?: string;
  lastAttemptAt?: string;
  connectedAt?: string;
}

interface McpToolDetails {
  serverId: string;
  serverName: string;
  remoteToolName: string;
  isError?: boolean;
}

const MCP_CONNECT_TIMEOUT_MS = 8_000;

interface ConnectedServer {
  hash: string;
  config: McpServerConfig;
  workspaceDir: string;
  state: McpConnectionState;
  client?: Client;
  transport?: StdioClientTransport | StreamableHTTPClientTransport;
  tools: AgentTool<any>[];
  lastError?: string;
  lastAttemptAt?: string;
  connectedAt?: string;
  closing: boolean;
}

function sanitizeToolNameSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

function toStringRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
      .filter(([key]) => Boolean(key))
  );
}

export function redactMcpError(message: string, server: McpServerConfig): string {
  let safe = message;
  const secrets = [
    ...Object.values(server.stdio.env ?? {}),
    ...Object.values(server.http.headers ?? {})
  ].map(String).filter((value) => value.length >= 3);
  for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
  if (server.http.url) {
    try {
      const url = new URL(server.http.url);
      if (url.username) url.username = "[REDACTED]";
      if (url.password) url.password = "[REDACTED]";
      if (url.search) url.search = "?redacted=1";
      safe = safe.split(server.http.url).join(url.toString());
    } catch {
      safe = safe.split(server.http.url).join("[REDACTED MCP URL]");
    }
  }
  return safe;
}

/**
 * Cap one MCP tool result to the shared tool-output budget.
 *
 * `read` and `bash` truncate their own output, but an MCP server is third-party
 * code whose result used to be inlined verbatim — one server returning a
 * multi-megabyte payload pushed the whole conversation past the model's context
 * window inside a single tool step. Neither existing defence covers that:
 * threshold compaction only runs between turns, and post-overflow compaction
 * cannot repair it either, because the oversized message is the most recent one
 * and compaction always keeps the tail.
 *
 * The budget is shared across all text parts of the result, so a server that
 * splits its payload into many small parts is bounded exactly like one that
 * returns a single blob. Image parts pass through: they are not text tokens and
 * dropping them would silently discard the answer for a vision turn.
 */
export function capMcpToolContent(
  content: Array<TextContent | ImageContent>,
  options: { spillDir?: string; spillPrefix?: string; maxBytes?: number; maxLines?: number } = {}
): Array<TextContent | ImageContent> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;

  const isText = (part: TextContent | ImageContent): part is TextContent => part.type === "text";
  const totalBytes = content.reduce(
    (sum, part) => (isText(part) ? sum + Buffer.byteLength(part.text, "utf-8") : sum),
    0
  );
  const totalLines = content.reduce(
    (sum, part) => (isText(part) ? sum + part.text.split("\n").length : sum),
    0
  );
  if (totalBytes <= maxBytes && totalLines <= maxLines) return content;

  const out: Array<TextContent | ImageContent> = [];
  let remainingBytes = maxBytes;
  let remainingLines = maxLines;

  for (const part of content) {
    if (!isText(part)) {
      out.push(part);
      continue;
    }
    if (remainingBytes <= 0 || remainingLines <= 0) continue;

    const truncation = truncateHead(part.text, { maxBytes: remainingBytes, maxLines: remainingLines });
    // A payload that is one enormous line (minified JSON, the common shape)
    // makes `truncateHead` return nothing at all; a hard byte slice is worse
    // formatting but infinitely better than handing the model an empty result.
    const kept = truncation.firstLineExceedsLimit
      ? sliceToBytes(part.text, remainingBytes)
      : truncation.content;
    if (!kept) continue;
    out.push({ type: "text", text: kept });
    remainingBytes -= Buffer.byteLength(kept, "utf-8");
    remainingLines -= kept.split("\n").length;
  }

  const fullText = content.filter(isText).map((part) => part.text).join("\n");
  const fullOutputPath = options.spillDir
    ? spillFullOutput(options.spillDir, fullText, options.spillPrefix ?? "mcp")
    : null;
  out.push({
    type: "text",
    text: `[MCP output truncated from ${totalLines} lines / ${formatSize(totalBytes)} to fit the tool-output budget.${
      fullOutputPath ? ` Full output: ${fullOutputPath}` : ""
    }]`
  });

  return out;
}

function normalizeToolContent(
  payload: unknown
): Array<TextContent | ImageContent> {
  if (!payload || typeof payload !== "object") {
    return [{ type: "text", text: String(payload ?? "(empty)") }];
  }

  const result = payload as {
    content?: Array<Record<string, unknown>>;
    structuredContent?: unknown;
  };
  const out: Array<TextContent | ImageContent> = [];
  const content = Array.isArray(result.content) ? result.content : [];

  for (const item of content) {
    const type = String(item?.type ?? "").trim();
    if (type === "text" && typeof item?.text === "string") {
      out.push({ type: "text", text: item.text });
      continue;
    }

    if (type === "image" && typeof item?.data === "string" && typeof item?.mimeType === "string") {
      out.push({ type: "image", data: item.data, mimeType: item.mimeType });
      continue;
    }

    if (type === "audio") {
      out.push({
        type: "text",
        text: `[MCP audio content omitted] mimeType=${String(item?.mimeType ?? "unknown")}`
      });
      continue;
    }

    if (type === "resource_link") {
      out.push({
        type: "text",
        text: `[MCP resource link] ${String(item?.name ?? item?.title ?? "resource")} -> ${String(item?.uri ?? "")}`
      });
      continue;
    }

    if (type === "resource" && item?.resource && typeof item.resource === "object") {
      const resource = item.resource as Record<string, unknown>;
      if (typeof resource.text === "string") {
        out.push({ type: "text", text: resource.text });
      } else if (typeof resource.blob === "string") {
        out.push({
          type: "text",
          text: `[MCP resource blob] uri=${String(resource.uri ?? "")} mimeType=${String(resource.mimeType ?? "")}`
        });
      } else {
        out.push({ type: "text", text: `[MCP resource] ${JSON.stringify(resource)}` });
      }
      continue;
    }

    out.push({ type: "text", text: `[MCP content] ${JSON.stringify(item)}` });
  }

  if (result.structuredContent !== undefined) {
    out.push({ type: "text", text: `[MCP structuredContent]\n${JSON.stringify(result.structuredContent, null, 2)}` });
  }

  if (out.length === 0) {
    out.push({ type: "text", text: "(MCP tool returned no content)" });
  }

  return out;
}

export class McpToolRegistry {
  private readonly servers = new Map<string, ConnectedServer>();
  private syncQueue: Promise<void> = Promise.resolve();

  private enqueueSync<T>(task: () => Promise<T>): Promise<T> {
    const next = this.syncQueue.then(task, task);
    this.syncQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private serverKey(workspaceDir: string, serverId: string): string {
    return `${workspaceDir}\u0000${serverId}`;
  }

  private async closeServer(server: ConnectedServer, state: McpConnectionState = "disconnected"): Promise<void> {
    server.closing = true;
    try {
      await server.client?.close();
    } catch {
      // ignore close errors
    } finally {
      server.client = undefined;
      server.transport = undefined;
      server.tools = [];
      server.state = state;
      server.lastError = undefined;
      server.connectedAt = undefined;
      server.closing = false;
    }
  }

  private buildToolName(server: McpServerConfig, remoteToolName: string): string {
    const prefix = sanitizeToolNameSegment(server.toolNamePrefix || server.id);
    return `mcp__${prefix}__${sanitizeToolNameSegment(remoteToolName)}`;
  }

  private buildServerHash(server: McpServerConfig): string {
    return JSON.stringify({
      id: server.id,
      enabled: server.enabled,
      transport: server.transport,
      stdio: server.stdio,
      http: server.http,
      toolNamePrefix: server.toolNamePrefix
    });
  }

  private async connectServer(
    server: McpServerConfig,
    options: McpRegistryOptions
  ): Promise<ConnectedServer> {
    const transport = server.transport === "http"
      ? new StreamableHTTPClientTransport(new URL(server.http.url), {
        requestInit: {
          headers: {
            ...toStringRecord(server.http.headers)
          }
        }
      })
      : (() => {
        const env = {
          ...toStringRecord(process.env),
          ...toStringRecord(server.stdio.env)
        };
        return new StdioClientTransport({
          command: server.stdio.command,
          args: server.stdio.args,
          cwd: server.stdio.cwd || options.workspaceDir,
          env
        });
      })();
    const client = new Client(
      { name: "molibot-mcp-client", version: "0.1.0" },
      { capabilities: {} }
    );

    const entry: ConnectedServer = {
      hash: this.buildServerHash(server),
      config: server,
      workspaceDir: options.workspaceDir,
      state: "connecting",
      client,
      transport,
      tools: [],
      lastAttemptAt: new Date().toISOString(),
      closing: false
    };
    const key = this.serverKey(options.workspaceDir, server.id);
    this.servers.set(key, entry);
    const markDisconnected = (error?: Error): void => {
      if (this.servers.get(key) !== entry || entry.closing) return;
      entry.state = error ? "error" : "disconnected";
      entry.lastError = error ? redactMcpError(error.message, server) : undefined;
      entry.client = undefined;
      entry.transport = undefined;
      entry.tools = [];
      entry.connectedAt = undefined;
      options.onWarn?.(error ? "mcp_server_transport_error" : "mcp_server_disconnected", {
        serverId: server.id,
        serverName: server.name,
        ...(error ? { error: redactMcpError(error.message, server) } : {})
      });
    };
    transport.onclose = () => markDisconnected();
    transport.onerror = (error) => markDisconnected(error);

    try {
      await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS });
      const listed = await client.listTools(undefined, { timeout: MCP_CONNECT_TIMEOUT_MS });
      entry.tools = listed.tools.map((remote): AgentTool<any> => {
        const parameters = Type.Unsafe<Record<string, unknown>>(
          remote.inputSchema && typeof remote.inputSchema === "object"
            ? remote.inputSchema
            : { type: "object", additionalProperties: true }
        );
        const localToolName = this.buildToolName(server, remote.name);

        return {
          name: localToolName,
          label: `mcp:${server.name}/${remote.name}`,
          description: `[MCP:${server.name}] ${remote.description || remote.name}`,
          parameters,
          execute: async (_toolCallId, params, signal): Promise<{ content: Array<TextContent | ImageContent>; details: McpToolDetails }> => {
            const toolArgs = params && typeof params === "object" ? params as Record<string, unknown> : {};
            const result = await client.callTool({
              name: remote.name,
              arguments: toolArgs
            }, undefined, {
              signal
            });
            const content = capMcpToolContent(normalizeToolContent(result), {
              spillDir: join(options.workspaceDir, ".mom-tool-output"),
              spillPrefix: `mcp-${sanitizeToolNameSegment(remote.name)}`
            });
            const details: McpToolDetails = {
              serverId: server.id,
              serverName: server.name,
              remoteToolName: remote.name,
              isError: Boolean(result.isError)
            };

            if (result.isError) {
              const text = content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n")
                .trim();
              throw new Error(text || `MCP tool ${server.name}/${remote.name} returned isError=true`);
            }

            return { content, details };
          }
        };
      });
      entry.state = "connected";
      entry.lastError = undefined;
      entry.connectedAt = new Date().toISOString();
      return entry;
    } catch (error) {
      const message = redactMcpError(error instanceof Error ? error.message : String(error), server);
      entry.closing = true;
      entry.client = undefined;
      entry.transport = undefined;
      entry.tools = [];
      try {
        await transport.close();
      } catch {
        // The failed transport may already be closed.
      }
      entry.closing = false;
      entry.state = "error";
      entry.lastError = message;
      throw error;
    }
  }

  private async ensureServer(server: McpServerConfig, options: McpRegistryOptions, force = false): Promise<void> {
    const key = this.serverKey(options.workspaceDir, server.id);
    const existing = this.servers.get(key);
    const hash = this.buildServerHash(server);
    if (!force && existing?.hash === hash && existing.state === "connected") return;
    if (existing) await this.closeServer(existing);
    try {
      await this.connectServer(server, options);
    } catch (error) {
      options.onWarn?.("mcp_server_connect_failed", {
        serverId: server.id,
        serverName: server.name,
        error: redactMcpError(error instanceof Error ? error.message : String(error), server)
      });
    }
  }

  async getTools(servers: McpServerConfig[], options: McpRegistryOptions): Promise<AgentTool<any>[]> {
    return this.enqueueSync(async () => {
      const enabled = servers.filter((server) => server.enabled);
      await Promise.all(enabled.map((server) => this.ensureServer(server, options)));
      return enabled.flatMap((server) => {
        const entry = this.servers.get(this.serverKey(options.workspaceDir, server.id));
        return entry?.state === "connected" ? entry.tools : [];
      });
    });
  }

  async reconnect(server: McpServerConfig, options: McpRegistryOptions): Promise<McpServerStatus> {
    await this.enqueueSync(() => this.ensureServer(server, options, true));
    const status = this.getStatuses([server], options.workspaceDir)[0];
    if (!status || status.state !== "connected") {
      throw new Error(status?.lastError || `MCP server could not be connected: ${server.id}`);
    }
    return status;
  }

  async reconcile(
    servers: McpServerConfig[],
    options: McpRegistryOptions & { connectEnabled?: boolean }
  ): Promise<void> {
    await this.enqueueSync(async () => {
      const configured = new Map(servers.map((server) => [server.id, server]));
      for (const [key, existing] of this.servers) {
        const next = configured.get(existing.config.id);
        if (next?.enabled) continue;
        await this.closeServer(existing, next ? "disabled" : "disconnected");
        if (!next) this.servers.delete(key);
        else {
          existing.config = next;
          existing.hash = this.buildServerHash(next);
        }
      }
      const enabledToConnect: McpServerConfig[] = [];
      for (const server of servers) {
        const key = this.serverKey(options.workspaceDir, server.id);
        if (!server.enabled) {
          if (!this.servers.has(key)) {
            this.servers.set(key, {
              hash: this.buildServerHash(server),
              config: server,
              workspaceDir: options.workspaceDir,
              state: "disabled",
              tools: [],
              closing: false
            });
          }
          continue;
        }
        if (options.connectEnabled) enabledToConnect.push(server);
      }
      await Promise.all(enabledToConnect.map((server) => this.ensureServer(server, options)));
    });
  }

  getStatuses(servers: McpServerConfig[], workspaceDir: string): McpServerStatus[] {
    return servers.map((server) => {
      const entry = this.servers.get(this.serverKey(workspaceDir, server.id));
      return {
        serverId: server.id,
        state: server.enabled ? entry?.state ?? "disconnected" : "disabled",
        toolCount: entry?.state === "connected" ? entry.tools.length : 0,
        ...(entry?.lastError ? { lastError: entry.lastError } : {}),
        ...(entry?.lastAttemptAt ? { lastAttemptAt: entry.lastAttemptAt } : {}),
        ...(entry?.connectedAt ? { connectedAt: entry.connectedAt } : {})
      };
    });
  }

  async closeAll(): Promise<void> {
    await this.enqueueSync(async () => {
      for (const server of this.servers.values()) await this.closeServer(server);
      this.servers.clear();
    });
  }
}

const registry = new McpToolRegistry();

export async function getMcpToolsForRuntime(
  servers: McpServerConfig[],
  options: McpRegistryOptions
): Promise<AgentTool<any>[]> {
  if (!Array.isArray(servers) || servers.length === 0) return [];
  return registry.getTools(servers, options);
}

export function getMcpServerStatuses(servers: McpServerConfig[], workspaceDir: string): McpServerStatus[] {
  return registry.getStatuses(servers, workspaceDir);
}

export async function reconcileMcpServers(
  servers: McpServerConfig[],
  options: McpRegistryOptions & { connectEnabled?: boolean }
): Promise<void> {
  await registry.reconcile(servers, options);
}

export async function reconnectMcpServer(server: McpServerConfig, options: McpRegistryOptions): Promise<McpServerStatus> {
  return registry.reconnect(server, options);
}
