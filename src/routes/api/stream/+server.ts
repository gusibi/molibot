import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  buildModelOptions,
  currentModelKey,
  parseModelRoute,
  switchModelSelection,
  type ModelRoute
} from "$lib/server/settings/modelSwitch";

function buildModelsText(route: ModelRoute): string {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const options = buildModelOptions(settings, route);
  const activeKey = currentModelKey(settings, route);
  const lines = [
    `Route: ${route}`,
    `Provider mode: ${settings.providerMode}`,
    `Configured model options: ${options.length}`,
    ""
  ];

  if (options.length === 0) {
    lines.push("No available model options.");
  } else {
    options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option.label}${option.key === activeKey ? " (active)" : ""}`);
      lines.push(`   key: ${option.key}`);
    });
  }

  return lines.join("\n");
}

function tryHandleStreamCommand(message: string): { ok: boolean; response: string } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || "";
  const rawArg = parts.slice(1).join(" ").trim();
  const runtime = getRuntime();

  if (cmd === "/help" || cmd === "/start") {
    return {
      ok: true,
      response: [
        "Available commands:",
        "/models",
        "/models <index|key>",
        "/models <text|vision|stt|tts>",
        "/models <text|vision|stt|tts> <index|key>"
      ].join("\n")
    };
  }

  if (cmd !== "/models") return null;
  if (!rawArg) {
    return { ok: true, response: buildModelsText("text") };
  }

  const [firstArg = "", secondArg = ""] = rawArg
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const maybeRoute = parseModelRoute(firstArg);
  const route: ModelRoute = maybeRoute ?? "text";
  const selector = maybeRoute ? secondArg : rawArg;
  if (!selector) {
    return { ok: true, response: buildModelsText(route) };
  }

  const result = switchModelSelection({
    settings: runtime.getSettings(),
    route,
    selector,
    updateSettings: runtime.updateSettings
  });
  if (!result) {
    return {
      ok: false,
      response: `Invalid model selector: ${selector}\n\n${buildModelsText(route)}`
    };
  }

  return {
    ok: true,
    response: [
      `Switched ${route} model to: ${result.selected.label}`,
      `Mode: ${result.settings.providerMode}`
    ].join("\n")
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const userId = url.searchParams.get("userId")?.trim() || "web-anonymous";
  const message = url.searchParams.get("message")?.trim() || "";
  const conversationId = url.searchParams.get("conversationId")?.trim() || undefined;

  const command = tryHandleStreamCommand(message);
  if (command) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: token\\ndata: ${JSON.stringify({ token: command.response })}\\n\\n`));
        controller.enqueue(encoder.encode(`event: done\\ndata: ${JSON.stringify({ ok: command.ok })}\\n\\n`));
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
  }

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
