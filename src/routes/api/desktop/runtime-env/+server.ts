import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import {
  DESKTOP_RUNTIME_DEPENDENCIES,
  buildDesktopRuntimeEnvSummary,
  detectRuntimeDependency
} from "$lib/server/app/desktopRuntimeEnv";
import type { DesktopRuntimeEnvResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  // Detection is best-effort: a probe failure must never break the page.
  const detections = DESKTOP_RUNTIME_DEPENDENCIES.map((spec) => {
    try {
      return detectRuntimeDependency(spec);
    } catch {
      return { id: spec.id, status: "unknown" as const, version: "", source: "" };
    }
  });

  const payload: DesktopRuntimeEnvResponse = {
    ok: true,
    summary: buildDesktopRuntimeEnvSummary(DESKTOP_RUNTIME_DEPENDENCIES, detections)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
