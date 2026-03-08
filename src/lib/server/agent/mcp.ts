import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { McpServerConfig } from "../settings/schema.js";

interface McpRegistryOptions {
  workspaceDir: string;
  onWarn?: (message: string, extra?: Record<string, unknown>) => void;
}

interface McpToolDetails {
  serverId: string;
  serverName: string;
  remoteToolName: string;
  isError?: boolean;
}

interface ConnectedServer {
  hash: string;
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: AgentTool<any>[];
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

class McpToolRegistry {
  private readonly servers = new Map<string, ConnectedServer>();
  private syncQueue: Promise<void> = Promise.resolve();

  private enqueueSync(task: () => Promise<void>): Promise<void> {
    const next = this.syncQueue.then(task, task);
    this.syncQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async closeServer(server: ConnectedServer): Promise<void> {
    try {
      await server.transport.close();
    } catch {
      // ignore close errors
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

    await client.connect(transport);
    const listed = await client.listTools();
    const tools = listed.tools.map((remote): AgentTool<any> => {
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
          const content = normalizeToolContent(result);
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

    return {
      hash: this.buildServerHash(server),
      config: server,
      client,
      transport,
      tools
    };
  }

  async sync(servers: McpServerConfig[], options: McpRegistryOptions): Promise<void> {
    await this.enqueueSync(async () => {
      const enabled = servers.filter((server) =>
        server.enabled && (server.transport === "stdio" || server.transport === "http")
      );
      const nextIds = new Set(enabled.map((server) => server.id));

      for (const [id, existing] of this.servers.entries()) {
        if (nextIds.has(id)) continue;
        await this.closeServer(existing);
        this.servers.delete(id);
      }

      for (const server of enabled) {
        const hash = this.buildServerHash(server);
        const existing = this.servers.get(server.id);
        if (existing && existing.hash === hash) continue;
        if (existing) {
          await this.closeServer(existing);
          this.servers.delete(server.id);
        }

        try {
          const connected = await this.connectServer(server, options);
          this.servers.set(server.id, connected);
        } catch (error) {
          options.onWarn?.("mcp_server_connect_failed", {
            serverId: server.id,
            serverName: server.name,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });
  }

  listTools(): AgentTool<any>[] {
    const out: AgentTool<any>[] = [];
    for (const server of this.servers.values()) {
      out.push(...server.tools);
    }
    return out;
  }
}

const registry = new McpToolRegistry();

export async function getMcpToolsForRuntime(
  servers: McpServerConfig[],
  options: McpRegistryOptions
): Promise<AgentTool<any>[]> {
  if (!Array.isArray(servers) || servers.length === 0) return [];
  await registry.sync(servers, options);
  return registry.listTools();
}
