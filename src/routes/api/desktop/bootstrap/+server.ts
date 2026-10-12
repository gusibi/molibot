import { storageRuntimeReady, storageMigrationStatus } from "$lib/server/sessions/agentStorageLifecycle.js";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolveDesktopProfiles } from "$lib/server/app/desktopBootstrap";
import { getRuntime } from "$lib/server/app/runtime";
import type { DesktopBootstrapResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  if (!storageRuntimeReady()) return json({ ok: false, code: "storage_migration_required", migration: storageMigrationStatus() }, { status: 503 });
  const payload: DesktopBootstrapResponse = {
    ok: true,
    profiles: resolveDesktopProfiles(getRuntime().getSettings())
  };
  return json(payload, {
    headers: { "Cache-Control": "no-store" }
  });
};
