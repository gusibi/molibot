import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMcpSummary, deleteDesktopMcpServer, saveDesktopMcpServer } from "$lib/server/app/desktopMcp";
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
    const updated = runtime.updateSettings({ mcpServers: saveDesktopMcpServer(runtime.getSettings(), body) });
    return json({ ok: true, summary: buildDesktopMcpSummary(updated) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  try {
    const runtime = getRuntime();
    const updated = runtime.updateSettings({ mcpServers: deleteDesktopMcpServer(runtime.getSettings(), url.searchParams.get("id") ?? "") });
    return json({ ok: true, summary: buildDesktopMcpSummary(updated) } satisfies DesktopMcpResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
