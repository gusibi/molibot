import type { McpServerConfig, RuntimeSettings } from "$lib/server/settings/schema";
import type { DesktopMcpItem, DesktopMcpSummary, DesktopMcpTransport } from "$lib/shared/desktop";

function coerceTransport(value: unknown): DesktopMcpTransport {
  return value === "http" ? "http" : "stdio";
}

function countKeys(record: Record<string, string> | undefined): number {
  return record ? Object.keys(record).length : 0;
}

/**
 * Maps an MCP server config into a credential-safe Desktop view. The
 * transport-specific secrets are dropped: stdio `env` values and `cwd`
 * (absolute path) and http `headers` (auth tokens) never reach the WebView —
 * only their counts do. `args` is reduced to a count too, since arguments can
 * carry inline tokens. The identifying `command` (stdio) and `url` (http) are
 * kept so a user can recognize the server, mirroring how providers expose
 * `baseUrl`.
 */
export function buildDesktopMcpItem(server: McpServerConfig): DesktopMcpItem {
  const transport = coerceTransport(server.transport);
  const stdio = server.stdio ?? { command: "", args: [], env: {}, cwd: "" };
  const http = server.http ?? { url: "", headers: {} };
  return {
    id: server.id,
    name: server.name || server.id,
    enabled: server.enabled !== false,
    transport,
    toolNamePrefix: server.toolNamePrefix ?? "",
    command: transport === "stdio" ? stdio.command ?? "" : "",
    argCount: transport === "stdio" && Array.isArray(stdio.args) ? stdio.args.length : 0,
    envKeyCount: transport === "stdio" ? countKeys(stdio.env) : 0,
    envKeys: transport === "stdio" ? Object.keys(stdio.env ?? {}).sort() : [],
    cwdConfigured: transport === "stdio" ? Boolean(stdio.cwd) : false,
    url: transport === "http" ? http.url ?? "" : "",
    headerCount: transport === "http" ? countKeys(http.headers) : 0,
    headerKeys: transport === "http" ? Object.keys(http.headers ?? {}).sort() : []
  };
}

export function saveDesktopMcpServer(settings: RuntimeSettings, input: import("$lib/shared/desktop").DesktopMcpSaveRequest): McpServerConfig[] {
  const id = String(input.id ?? "").trim();
  const previousId = String(input.previousId ?? "").trim();
  if (!id) throw new Error("MCP server id is required");
  if (input.transport !== "stdio" && input.transport !== "http") throw new Error("Unsupported MCP transport");
  const servers = Array.isArray(settings.mcpServers) ? settings.mcpServers : [];
  const existingIndex = previousId ? servers.findIndex((server) => server.id === previousId) : -1;
  if (previousId && existingIndex < 0) throw new Error(`Unknown MCP server: ${previousId}`);
  if (servers.some((server, index) => server.id === id && index !== existingIndex)) throw new Error(`MCP server already exists: ${id}`);
  const existing = existingIndex >= 0 ? servers[existingIndex] : undefined;
  const command = String(input.command ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (input.transport === "stdio" && !command) throw new Error("stdio command is required");
  if (input.transport === "http" && !url) throw new Error("HTTP URL is required");

  const env = { ...(existing?.stdio.env ?? {}) };
  for (const key of input.clearEnvKeys ?? []) delete env[String(key).trim()];
  for (const [key, value] of Object.entries(input.envValues ?? {})) {
    const normalizedKey = key.trim();
    if (normalizedKey && value !== "") env[normalizedKey] = String(value);
  }
  const headers = { ...(existing?.http.headers ?? {}) };
  for (const key of input.clearHeaderKeys ?? []) delete headers[String(key).trim()];
  for (const [key, value] of Object.entries(input.headerValues ?? {})) {
    const normalizedKey = key.trim();
    if (normalizedKey && value !== "") headers[normalizedKey] = String(value);
  }
  const server: McpServerConfig = {
    id,
    name: String(input.name ?? "").trim() || id,
    enabled: input.enabled !== false,
    transport: input.transport,
    toolNamePrefix: String(input.toolNamePrefix ?? "").trim(),
    stdio: {
      command,
      args: input.clearArgs ? [] : input.args ? input.args.map((value) => String(value).trim()).filter(Boolean) : [...(existing?.stdio.args ?? [])],
      env,
      cwd: input.clearCwd ? "" : input.cwdValue?.trim() || existing?.stdio.cwd || ""
    },
    http: { url, headers }
  };
  return existingIndex >= 0
    ? servers.map((item, index) => index === existingIndex ? server : item)
    : [...servers, server];
}

export function deleteDesktopMcpServer(settings: RuntimeSettings, id: string): McpServerConfig[] {
  const servers = Array.isArray(settings.mcpServers) ? settings.mcpServers : [];
  if (!servers.some((server) => server.id === id)) throw new Error(`Unknown MCP server: ${id}`);
  return servers.filter((server) => server.id !== id);
}

export function buildDesktopMcpSummary(settings: RuntimeSettings): DesktopMcpSummary {
  const servers = Array.isArray(settings.mcpServers) ? settings.mcpServers : [];
  const items = servers.map(buildDesktopMcpItem);
  return {
    items,
    counts: {
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      stdio: items.filter((item) => item.transport === "stdio").length,
      http: items.filter((item) => item.transport === "http").length
    }
  };
}
