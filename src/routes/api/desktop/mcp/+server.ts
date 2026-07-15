import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMcpSummary, deleteDesktopMcpServer, saveDesktopMcpServer } from "$lib/server/app/desktopMcp";
import { replaceMcpServers } from "$lib/server/settings/handlers/mcp";
import type { DesktopMcpResponse, DesktopMcpSaveRequest } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopMcpResponse = {
    ok: true,
    summary: buildDesktopMcpSummary(runtime.getSettings())
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as DesktopMcpSaveRequest;
    const nextServers = saveDesktopMcpServer(runtime.getSettings(), body);
    const { settings } = replaceMcpServers(runtime, nextServers);
    return json({ ok: true, summary: buildDesktopMcpSummary(settings) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  try {
    const runtime = getRuntime();
    const nextServers = deleteDesktopMcpServer(runtime.getSettings(), url.searchParams.get("id") ?? "");
    const { settings } = replaceMcpServers(runtime, nextServers);
    return json({ ok: true, summary: buildDesktopMcpSummary(settings) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
