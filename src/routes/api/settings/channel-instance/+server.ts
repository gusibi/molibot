import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { deleteChannelInstance, listChannelInstances, upsertChannelInstance } from "$lib/server/settings/handlers/channels";

export const GET: RequestHandler = async ({ url }) => {
  const channel = url.searchParams.get("channel") ?? "";
  if (!channel) {
    return json({ ok: false, error: "channel query param is required" }, { status: 400 });
  }
  try {
    const instances = listChannelInstances(getRuntime(), channel);
    return json({ ok: true, channel, instances });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { channel?: string; previousId?: string; instance?: unknown };
  try {
    body = (await request.json()) as { channel?: string; previousId?: string; instance?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const channel = String(body.channel ?? "").trim();
  if (!channel) {
    return json({ ok: false, error: "channel is required" }, { status: 400 });
  }
  if (!body.instance || typeof body.instance !== "object") {
    return json({ ok: false, error: "instance is required" }, { status: 400 });
  }

  try {
    const instance = upsertChannelInstance(getRuntime(), channel, body.instance, body.previousId);
    return json({ ok: true, instance });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ request }) => {
  let body: { channel?: string; id?: string };
  try {
    body = (await request.json()) as { channel?: string; id?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const channel = String(body.channel ?? "").trim();
  const id = String(body.id ?? "").trim();
  if (!channel || !id) {
    return json({ ok: false, error: "channel and id are required" }, { status: 400 });
  }

  try {
    deleteChannelInstance(getRuntime(), channel, id);
    return json({ ok: true });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};
