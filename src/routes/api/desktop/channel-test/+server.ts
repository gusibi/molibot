import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { testDesktopChannel } from "$lib/server/app/desktopChannelTest";
import type { DesktopChannelTestRequest } from "$lib/shared/desktop";

export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopChannelTestRequest;
  try { body = (await request.json()) as DesktopChannelTestRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  const result = await testDesktopChannel(getRuntime().getSettings(), body);
  return json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
};
