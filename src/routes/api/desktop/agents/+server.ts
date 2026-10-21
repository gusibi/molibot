import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopAgentsSummary } from "$lib/server/app/desktopAgents";
import { listDesktopAgentConversations } from "$lib/server/app/desktopConversations";
import { AgentDeleteBlockedError, deleteAgent, upsertAgent } from "$lib/server/settings/handlers/agents";
import type { DesktopAgentSaveRequest, DesktopAgentsResponse } from "$lib/shared/desktop";

/** Agents carry the server's ordering and execution gate, so no surface re-derives them. */
function agentsSummary(runtime: ReturnType<typeof getRuntime>): DesktopAgentsResponse["summary"] {
  const latest = listDesktopAgentConversations({ limit: 1 }).latestConversationAtByAgent;
  return buildDesktopAgentsSummary(runtime.getSettings(), latest);
}

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopAgentsResponse = {
    ok: true,
    summary: agentsSummary(runtime)
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
    return json({ ok: true, summary: agentsSummary(runtime) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const blockers = error instanceof AgentDeleteBlockedError ? error.blockers : undefined;
    return json({ ok: false, error: error instanceof Error ? error.message : String(error), ...(blockers ? { blockers } : {}) }, { status: 400 });
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
    return json({ ok: true, summary: agentsSummary(runtime) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const blockers = error instanceof AgentDeleteBlockedError ? error.blockers : undefined;
    return json({ ok: false, error: error instanceof Error ? error.message : String(error), ...(blockers ? { blockers } : {}) }, { status: 400 });
  }
};
