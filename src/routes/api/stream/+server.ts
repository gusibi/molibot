import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/runtime";

export const GET: RequestHandler = async ({ url }) => {
  const userId = url.searchParams.get("userId")?.trim() || "web-anonymous";
  const message = url.searchParams.get("message")?.trim() || "";
  const conversationId = url.searchParams.get("conversationId")?.trim() || undefined;

  const { router } = getRuntime();
  const result = await router.handle({
    channel: "web",
    externalUserId: userId,
    content: message,
    conversationId
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      if (!result.ok) {
        controller.enqueue(encoder.encode(`event: error\\ndata: ${JSON.stringify(result)}\\n\\n`));
        controller.close();
        return;
      }

      const response = result.response ?? "";
      for (const token of response.split(" ")) {
        controller.enqueue(encoder.encode(`event: token\\ndata: ${JSON.stringify({ token })}\\n\\n`));
      }

      controller.enqueue(encoder.encode(`event: done\\ndata: ${JSON.stringify({ ok: true })}\\n\\n`));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
};
