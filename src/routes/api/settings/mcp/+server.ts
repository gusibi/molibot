import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { listMcpServers, replaceMcpServers } from "$lib/server/settings/handlers/mcp";
import { config } from "$lib/server/app/env";
import { getMcpServerStatuses, reconcileMcpServers, reconnectMcpServer } from "$lib/server/agent/tools/mcp";
import { effectiveMcpServers } from "$lib/server/settings/openConnector";

async function responsePayload(connectEnabled = false) {
  const runtime = getRuntime();
  const servers = listMcpServers(runtime);
  await reconcileMcpServers(effectiveMcpServers(runtime.getSettings()), { workspaceDir: config.webWorkspaceDir, connectEnabled });
  return { ok: true, mcpServers: servers, statuses: getMcpServerStatuses(servers, config.webWorkspaceDir) };
}

export const GET: RequestHandler = async () => {
  try {
    return json(await responsePayload(), { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { mcpServers?: unknown } | unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body && typeof body === "object" && "mcpServers" in (body as Record<string, unknown>)
    ? (body as { mcpServers: unknown }).mcpServers
    : body;

  try {
    replaceMcpServers(getRuntime(), payload);
    return json(await responsePayload(true));
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

export const PATCH: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as { id?: string; enabled?: boolean };
    const id = String(body.id ?? "").trim();
    const servers = listMcpServers(runtime);
    if (!servers.some((server) => server.id === id)) throw new Error(`Unknown MCP server: ${id}`);
    replaceMcpServers(runtime, servers.map((server) => server.id === id ? { ...server, enabled: Boolean(body.enabled) } : server));
    return json(await responsePayload(Boolean(body.enabled)));
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as { id?: string; action?: string };
    const id = String(body.id ?? "").trim();
    if (body.action !== "reconnect") throw new Error("Unsupported MCP action");
    const server = listMcpServers(runtime).find((item) => item.id === id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (!server.enabled) throw new Error(`MCP server is disabled: ${id}`);
    await reconnectMcpServer(server, { workspaceDir: config.webWorkspaceDir });
    return json(await responsePayload());
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  try {
    const runtime = getRuntime();
    const id = String(url.searchParams.get("id") ?? "").trim();
    const servers = listMcpServers(runtime);
    if (!servers.some((server) => server.id === id)) throw new Error(`Unknown MCP server: ${id}`);
    replaceMcpServers(runtime, servers.filter((server) => server.id !== id));
    return json(await responsePayload());
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
