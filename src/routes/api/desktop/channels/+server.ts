import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopChannelsSummary, deleteDesktopChannelInstance, saveDesktopChannelInstance } from "$lib/server/app/desktopChannels";
import type { DesktopChannelSaveRequest, DesktopChannelsResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopChannelsResponse = {
    ok: true,
    summary: buildDesktopChannelsSummary(runtime.getSettings())
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: DesktopChannelSaveRequest;
  try { body = (await request.json()) as DesktopChannelSaveRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const runtime = getRuntime();
    const instances = saveDesktopChannelInstance(runtime.getSettings(), body);
    const updated = runtime.updateSettings({ channels: { [body.channel]: { instances } } });
    return json({ ok: true, summary: buildDesktopChannelsSummary(updated) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const channel = String(url.searchParams.get("channel") ?? "");
  const id = String(url.searchParams.get("id") ?? "");
  try {
    const runtime = getRuntime();
    const instances = deleteDesktopChannelInstance(runtime.getSettings(), channel, id);
    const updated = runtime.updateSettings({ channels: { [channel]: { instances } } });
    return json({ ok: true, summary: buildDesktopChannelsSummary(updated) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
