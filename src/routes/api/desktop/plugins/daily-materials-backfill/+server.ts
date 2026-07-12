import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { collectDailyMaterialsBackfillInternals } from "$lib/server/agent/taskScheduler";
import type { DailyMaterialsInternal } from "$lib/server/memory/dailyMaterials";
import type { DailyMaterialsBackfillResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  return json({ ok: true, status: runtime.dailyMaterialsBackfill.getStatus() } satisfies DailyMaterialsBackfillResponse, {
    headers: { "Cache-Control": "no-store" }
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const runtime = getRuntime();
  const body = await request.json().catch(() => ({})) as { action?: string };
  const action = body.action ?? "status";
  try {
    if (action === "start") {
      const internals = collectDailyMaterialsBackfillInternals(runtime.getSettings()) as unknown as DailyMaterialsInternal[];
      const status = runtime.dailyMaterialsBackfill.start(internals);
      return json({ ok: true, status } satisfies DailyMaterialsBackfillResponse);
    }
    if (action === "status") {
      return json({ ok: true, status: runtime.dailyMaterialsBackfill.getStatus() } satisfies DailyMaterialsBackfillResponse);
    }
    return json({ ok: false, error: "Unsupported action" }, { status: 400 });
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
