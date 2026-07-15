import { sanitizeMcpServers } from "../sanitize.js";
import type { McpServerConfig, RuntimeSettings } from "../schema.js";
import type { SettingsAccessor } from "./locale.js";

export function listMcpServers(runtime: SettingsAccessor): McpServerConfig[] {
  return runtime.getSettings().mcpServers ?? [];
}

export function replaceMcpServers(runtime: SettingsAccessor, raw: unknown): { settings: RuntimeSettings; servers: McpServerConfig[] } {
  const mcpServers = sanitizeMcpServers(raw);
  const settings = runtime.updateSettings({ mcpServers });
  return { settings, servers: settings.mcpServers };
}
