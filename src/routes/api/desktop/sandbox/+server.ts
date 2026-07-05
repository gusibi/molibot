import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getRuntime } from "$lib/server/app/runtime";
import { getToolSandboxDiagnostics } from "$lib/server/agent/tools/sandbox";
import { buildDesktopSandboxSummary, buildDesktopSandboxUpdate } from "$lib/server/app/desktopSandbox";
import { updateSystemConfig } from "$lib/server/settings/handlers/system";
import type {
  DesktopSandboxPatchResponse,
  DesktopSandboxResponse,
  DesktopSandboxUpdateRequest
} from "$lib/shared/desktop";

async function buildSummary() {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const workspaceDir = resolve(config.webWorkspaceDir);
  const diagnostics = await getToolSandboxDiagnostics(settings.toolSandbox, workspaceDir, workspaceDir);
  return buildDesktopSandboxSummary(settings.toolSandbox, diagnostics);
}

export const GET: RequestHandler = async () => {
  try {
    const sandbox = await buildSummary();
    const payload: DesktopSandboxResponse = { ok: true, sandbox };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopSandboxUpdateRequest;
  try {
    body = (await request.json()) as DesktopSandboxUpdateRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const runtime = getRuntime();
    const current = runtime.getSettings().toolSandbox;
    const nextSandbox = buildDesktopSandboxUpdate(current, body);
    updateSystemConfig(runtime, { toolSandbox: nextSandbox });
    const sandbox = await buildSummary();
    const payload: DesktopSandboxPatchResponse = { ok: true, sandbox };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};
