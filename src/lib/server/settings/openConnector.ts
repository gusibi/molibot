import type { McpServerConfig, RuntimeSettings } from "./schema.js";

export const OPEN_CONNECTOR_MCP_ID = "open-connector";

export function openConnectorMcpServer(settings: RuntimeSettings): McpServerConfig | null {
  const connector = settings.openConnector;
  if (!connector?.enabled || !connector.baseUrl || !connector.runtimeToken) return null;
  return {
    id: OPEN_CONNECTOR_MCP_ID,
    name: "OpenConnector",
    enabled: true,
    transport: "http",
    stdio: { command: "", args: [], env: {}, cwd: "" },
    http: {
      url: `${connector.baseUrl.replace(/\/+$/, "")}/mcp`,
      headers: { Authorization: `Bearer ${connector.runtimeToken}` }
    },
    toolNamePrefix: "connector"
  };
}

export function effectiveMcpServers(settings: RuntimeSettings): McpServerConfig[] {
  const managed = openConnectorMcpServer(settings);
  const configured = (settings.mcpServers ?? []).filter((server) => server.id !== OPEN_CONNECTOR_MCP_ID);
  return managed ? [...configured, managed] : configured;
}
