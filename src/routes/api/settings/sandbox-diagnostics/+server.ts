import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { getToolSandboxDiagnostics } from "$lib/server/agent/tools/sandbox";
import { getRuntime } from "$lib/server/app/runtime";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const workspaceDir = config.webWorkspaceDir;

  try {
    const diagnostics = await getToolSandboxDiagnostics(
      settings.toolSandbox,
      resolve(workspaceDir),
      resolve(workspaceDir)
    );
    return json({ ok: true, diagnostics });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};
