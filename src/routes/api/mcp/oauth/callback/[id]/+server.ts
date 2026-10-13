import type { RequestHandler } from "@sveltejs/kit";
import { getMcpOAuthManager } from "$lib/server/agent/mcp/oauthRuntime";

export const GET: RequestHandler = async ({ params, url }) => getMcpOAuthManager().forwardCallback(params.id!, url);
