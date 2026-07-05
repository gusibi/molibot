import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopAgentsSummary } from "$lib/server/app/desktopAgents";
import { deleteAgent, upsertAgent } from "$lib/server/settings/handlers/agents";
import type { DesktopAgentSaveRequest, DesktopAgentsResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopAgentsResponse = {
    ok: true,
    summary: buildDesktopAgentsSummary(runtime.getSettings())
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: DesktopAgentSaveRequest;
  try { body = (await request.json()) as DesktopAgentSaveRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const runtime = getRuntime();
    upsertAgent(runtime, body, body.previousId);
    const updated = runtime.getSettings();
    return json({ ok: true, summary: buildDesktopAgentsSummary(updated) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) {
    return json({ ok: false, error: "id is required" }, { status: 400 });
  }
  try {
    const runtime = getRuntime();
    deleteAgent(runtime, id);
    const updated = runtime.getSettings();
    return json({ ok: true, summary: buildDesktopAgentsSummary(updated) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
