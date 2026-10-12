import type { McpAuthMode, McpServerAuthConfig, McpTransport } from "./schema.js";

/**
 * Resolve one MCP server's authentication choice from raw settings.
 *
 * OAuth is HTTP-only and must not be mixed with a manual `Authorization`
 * header: two token sources on one server make the effective credential
 * ambiguous. Selecting OAuth therefore drops any manual `Authorization` header,
 * while stdio and the default stay on manual headers.
 */
export function resolveMcpAuthConfig(
  transport: McpTransport,
  item: Record<string, unknown>,
  headers: Record<string, string>
): McpServerAuthConfig {
  const authRaw = item.auth && typeof item.auth === "object" ? item.auth as Record<string, unknown> : {};
  const oauthRaw = authRaw.oauth && typeof authRaw.oauth === "object" ? authRaw.oauth as Record<string, unknown> : {};
  const mode: McpAuthMode = transport === "http" && String(authRaw.mode ?? "").trim().toLowerCase() === "oauth" ? "oauth" : "headers";
  if (mode === "oauth") for (const key of Object.keys(headers)) if (key.toLowerCase() === "authorization") delete headers[key];
  return {
    mode,
    oauth: {
      authServerMetadataUrl: String(oauthRaw.authServerMetadataUrl ?? authRaw.authServerMetadataUrl ?? "").trim(),
      clientName: String(oauthRaw.clientName ?? authRaw.clientName ?? "").trim()
    }
  };
}
