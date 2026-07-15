import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { deleteAgent, listAgents, upsertAgent } from "$lib/server/settings/handlers/agents";

export const GET: RequestHandler = async () => {
  try {
    const agents = listAgents(getRuntime());
    return json({ ok: true, agents });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { previousId?: string; agent?: unknown };
  try {
    body = (await request.json()) as { previousId?: string; agent?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.agent || typeof body.agent !== "object") {
    return json({ ok: false, error: "agent is required" }, { status: 400 });
  }

  try {
    const agent = upsertAgent(getRuntime(), body.agent, body.previousId);
    return json({ ok: true, agent });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ request }) => {
  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) {
    return json({ ok: false, error: "id is required" }, { status: 400 });
  }

  try {
    deleteAgent(getRuntime(), id);
    return json({ ok: true });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};
