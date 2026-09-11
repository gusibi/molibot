import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { DEFAULT_PERMISSION_MODE, PERMISSION_MODES } from "$lib/server/agent/permissions/decidePermission";
import type { DesktopExecutionDefaultPatchResponse, DesktopExecutionDefaultResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const mode = runtime.getSettings().permissionMode ?? DEFAULT_PERMISSION_MODE;
  const payload: DesktopExecutionDefaultResponse = { ok: true, mode };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: { mode?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!PERMISSION_MODES.includes(body.mode as never)) {
    return json({ ok: false, error: "Invalid permission mode" }, { status: 400 });
  }
  const runtime = getRuntime();
  const updated = runtime.updateSettings({ permissionMode: body.mode as typeof PERMISSION_MODES[number] });
  const payload: DesktopExecutionDefaultPatchResponse = { ok: true, mode: updated.permissionMode ?? DEFAULT_PERMISSION_MODE };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
