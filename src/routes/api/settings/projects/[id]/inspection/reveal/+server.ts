import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { spawn } from "node:child_process";
import { getProjectFilePath } from "$lib/server/projects/inspection.js";
import { getProjectStore } from "$lib/server/projects/store.js";

/**
 * Hands a Project file to Finder. The WebView only ever knows Project-relative
 * paths, so the absolute path is resolved here — inside the Project root check —
 * and never travels back to the client.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { path?: unknown; mode?: unknown };
  const filePath = typeof body.path === "string" ? body.path : "";
  if (!filePath) return json({ ok: false, error: "File path is required" }, { status: 400 });
  const mode = body.mode === "open" ? "open" : "reveal";

  if (process.platform !== "darwin") {
    return json({ ok: false, error: "Revealing files is only supported on macOS." }, { status: 400 });
  }

  try {
    const absolutePath = await getProjectFilePath(project, filePath);
    // `open` is spawned without a shell and with an argument array, so a path
    // containing spaces or quotes cannot turn into extra arguments.
    const child = spawn("open", mode === "reveal" ? ["-R", absolutePath] : [absolutePath], {
      stdio: "ignore",
      shell: false,
      detached: true
    });
    child.on("error", () => { /* Finder failing to launch must not crash the service. */ });
    child.unref();
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
