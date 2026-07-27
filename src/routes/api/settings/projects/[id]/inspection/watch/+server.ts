import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { watchProject, type ProjectChangeBatch } from "$lib/server/projects/watcher.js";
import { getProjectStore } from "$lib/server/projects/store.js";

const HEARTBEAT_MS = 25_000;

export const GET: RequestHandler = async ({ params, request }) => {
  const project = getProjectStore().get(params.id);
  if (!project) return json({ ok: false, error: "Unknown project" }, { status: 404 });

  const encoder = new TextEncoder();
  let release: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  /**
   * `controller.close()` does not invoke `cancel()`, and a client that simply
   * disappears only invokes `cancel()`. Both paths funnel here so the shared
   * watcher's reference count is always released exactly once.
   */
  const cleanup = () => {
    release?.();
    release = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client went away between the change and this write.
        }
      };
      try {
        release = await watchProject(project, (batch: ProjectChangeBatch) => send("change", batch));
      } catch (error) {
        send("unavailable", { reason: error instanceof Error ? error.message : String(error) });
        controller.close();
        return;
      }
      send("ready", { ok: true });
      heartbeat = setInterval(() => send("ping", { at: Date.now() }), HEARTBEAT_MS);
      heartbeat.unref?.();
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel: cleanup
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
};
