import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  deleteDesktopWebProfile,
  patchDesktopWebProfile,
  resolveDesktopWebProfiles,
  saveDesktopWebProfile
} from "$lib/server/app/desktopProfiles";
import type {
  DesktopWebProfileSaveRequest,
  DesktopWebProfilePatch,
  DesktopWebProfileUpdateResponse,
  DesktopWebProfilesResponse
} from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const profiles = resolveDesktopWebProfiles(getRuntime().getSettings());
  const payload: DesktopWebProfilesResponse = { ok: true, profiles };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: { id?: string; name?: string; enabled?: boolean; agentId?: string };
  try {
    body = (await request.json()) as { id?: string; name?: string; enabled?: boolean; agentId?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) {
    return json({ ok: false, error: "id is required" }, { status: 400 });
  }

  if (body.name === undefined && body.enabled === undefined && body.agentId === undefined) {
    return json({ ok: false, error: "name, enabled, or agentId is required" }, { status: 400 });
  }

  const patch: DesktopWebProfilePatch = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  if (body.agentId !== undefined) patch.agentId = String(body.agentId);

  const runtime = getRuntime();
  let instances;
  try {
    instances = patchDesktopWebProfile(runtime.getSettings(), id, patch);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Invalid profile" }, { status: 400 });
  }

  const updated = runtime.updateSettings({
    channels: { web: { instances } }
  });
  const profile = resolveDesktopWebProfiles(updated).find((item) => item.id === id);
  if (!profile) {
    return json({ ok: false, error: "Web profile not found after update" }, { status: 500 });
  }

  const payload: DesktopWebProfileUpdateResponse = { ok: true, profile };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: DesktopWebProfileSaveRequest;
  try { body = (await request.json()) as DesktopWebProfileSaveRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const runtime = getRuntime();
    const instances = saveDesktopWebProfile(runtime.getSettings(), body);
    const updated = runtime.updateSettings({ channels: { web: { instances } } });
    const profile = resolveDesktopWebProfiles(updated).find((item) => item.id === body.id);
    if (!profile) throw new Error("Web profile not found after save");
    return json({ ok: true, profile } satisfies DesktopWebProfileUpdateResponse, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = String(url.searchParams.get("id") ?? "").trim();
  try {
    const runtime = getRuntime();
    const instances = deleteDesktopWebProfile(runtime.getSettings(), id);
    runtime.updateSettings({ channels: { web: { instances } } });
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
