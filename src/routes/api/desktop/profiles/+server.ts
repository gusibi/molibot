import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  patchDesktopWebProfile,
  resolveDesktopWebProfiles
} from "$lib/server/app/desktopProfiles";
import { replaceChannelInstances } from "$lib/server/settings/handlers/channels";
import type {
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

  try {
    replaceChannelInstances(runtime, "web", instances);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const updated = runtime.getSettings();
  const profile = resolveDesktopWebProfiles(updated).find((item) => item.id === id);
  if (!profile) {
    return json({ ok: false, error: "Web profile not found after update" }, { status: 500 });
  }

  const payload: DesktopWebProfileUpdateResponse = { ok: true, profile };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
