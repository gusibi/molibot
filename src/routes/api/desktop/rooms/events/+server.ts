import type { RequestHandler } from "@sveltejs/kit";
import { getRoomService, getRoomStore } from "$lib/server/rooms/runtime.js";
export const GET: RequestHandler = ({ url, request }) => {
  const id = url.searchParams.get("roomId") ?? "";
  try { getRoomService().view(id); }
  catch { return new Response("Room unavailable", { status: 404 }); }
  let cursor = Number(url.searchParams.get("after") ?? request.headers.get("Last-Event-ID") ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return new Response("Invalid event cursor", { status: 400 });
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { if (timer) clearInterval(timer); };
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = () => {
        try {
          getRoomService().view(id);
          const events = getRoomStore().events(id, cursor);
          for (const event of events) {
            controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: room\ndata: ${JSON.stringify(event)}\n\n`));
            cursor = event.sequence;
          }
          if (!events.length) controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch { stop(); controller.close(); }
      };
      emit(); timer = setInterval(emit, 1000);
      request.signal.addEventListener("abort", () => { stop(); try { controller.close(); } catch {} }, { once: true });
    },
    cancel: stop
  }), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
};
