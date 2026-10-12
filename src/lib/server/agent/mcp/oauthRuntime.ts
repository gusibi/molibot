import { config } from "$lib/server/app/env.js";
import { McpOAuthManager } from "./oauth.js";
import { McpOAuthStore, mcpOAuthStorePath } from "./oauthStore.js";

let singleton: McpOAuthManager | undefined;

/** Process-wide MCP OAuth manager bound to the owner's protected credential file. */
export function getMcpOAuthManager(): McpOAuthManager {
  if (!singleton) singleton = new McpOAuthManager({ store: new McpOAuthStore(mcpOAuthStorePath(config.dataDir)) });
  return singleton;
}

/** Test seam: drop the singleton so a fresh data directory is used. */
export function resetMcpOAuthManager(): void {
  singleton = undefined;
}
