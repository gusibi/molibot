import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMcpSummary, deleteDesktopMcpServer, saveDesktopMcpServer } from "$lib/server/app/desktopMcp";
import { replaceMcpServers } from "$lib/server/settings/handlers/mcp";
import { config } from "$lib/server/app/env";
import { getMcpServerStatuses, reconcileMcpServers, reconnectMcpServer } from "$lib/server/agent/tools/mcp";
import { effectiveMcpServers } from "$lib/server/settings/openConnector";
import type { DesktopMcpResponse, DesktopMcpSaveRequest, DesktopMcpToggleRequest } from "$lib/shared/desktop";

async function liveSummary(runtime: ReturnType<typeof getRuntime>, connectEnabled = false) {
  const settings = runtime.getSettings();
  const runtimeServers = effectiveMcpServers(settings);
  await reconcileMcpServers(runtimeServers, { workspaceDir: config.webWorkspaceDir, connectEnabled });
  return buildDesktopMcpSummary(settings, getMcpServerStatuses(runtimeServers, config.webWorkspaceDir));
}

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopMcpResponse = {
    ok: true,
    summary: await liveSummary(runtime)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as DesktopMcpSaveRequest;
    const nextServers = saveDesktopMcpServer(runtime.getSettings(), body);
    replaceMcpServers(runtime, nextServers);
    return json({ ok: true, summary: await liveSummary(runtime, true) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  try {
    const runtime = getRuntime();
    const nextServers = deleteDesktopMcpServer(runtime.getSettings(), url.searchParams.get("id") ?? "");
    replaceMcpServers(runtime, nextServers);
    return json({ ok: true, summary: await liveSummary(runtime) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

export const PATCH: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as DesktopMcpToggleRequest;
    const id = String(body.id ?? "").trim();
    const servers = runtime.getSettings().mcpServers ?? [];
    if (!servers.some((server) => server.id === id)) throw new Error(`Unknown MCP server: ${id}`);
    replaceMcpServers(runtime, servers.map((server) => server.id === id ? { ...server, enabled: Boolean(body.enabled) } : server));
    return json({ ok: true, summary: await liveSummary(runtime, Boolean(body.enabled)) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as { id?: string; action?: string };
    const action = String(body.action ?? "").trim();
    const id = String(body.id ?? "").trim();
    if (action === "reconnectAll") {
      // Reuse the shared boot-time reconcile primitive: connect every enabled
      // server (idempotent - already-connected servers are skipped), then return
      // a fresh summary. The desktop fires this on app reopen so enabled servers
      // auto-connect without the user clicking Reconnect for each one. Kept off
      // the GET path so a misconfigured server cannot stall the list load.
      return json({ ok: true, summary: await liveSummary(runtime, true) } satisfies DesktopMcpResponse);
    }
    if (action !== "reconnect") throw new Error("Unsupported MCP action");
    const server = effectiveMcpServers(runtime.getSettings()).find((item) => item.id === id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (!server.enabled) throw new Error(`MCP server is disabled: ${id}`);
    await reconnectMcpServer(server, { workspaceDir: config.webWorkspaceDir });
    return json({ ok: true, summary: await liveSummary(runtime) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
