import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { setChannelAgentBinding } from "$lib/server/settings/handlers/channels";

export const GET: RequestHandler = () => {
  const items = Object.entries(getRuntime().getSettings().channels).flatMap(([channel, group]) => group.instances.map(instance => ({ channel, id: instance.id, name: instance.name, agentId: instance.agentId })));
  return json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
};
export const PUT: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    setChannelAgentBinding(getRuntime(), String(body.channel ?? ""), String(body.id ?? ""), String(body.agentId ?? ""));
    return json({ ok: true });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
};
