import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { piExtensionTerminalHost } from "$lib/server/plugins/piExtensions/nativeTerminal.js";

export const GET: RequestHandler = ({ url }) => {
  try {
    const id = url.searchParams.get("id");
    if (url.searchParams.get("client") === "desktop") piExtensionTerminalHost.heartbeat();
    if (!id) return json({ ok: true, terminals: piExtensionTerminalHost.list() });
    const after = Number(url.searchParams.get("after") ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) return json({ ok: false, error: "Invalid terminal cursor." }, { status: 400 });
    return json({ ok: true, ...piExtensionTerminalHost.output(id, after) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Terminal unavailable." }, { status: 404 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const input = await request.json();
    if (typeof input.id !== "string") throw new Error("Terminal id is required.");
    if (input.action === "input" && typeof input.data === "string") await piExtensionTerminalHost.input(input.id, input.data);
    else if (input.action === "respond" && typeof input.dialogId === "string") piExtensionTerminalHost.respond(input.id, input.dialogId, input.value);
    else if (input.action === "resize") await piExtensionTerminalHost.resize(input.id, input.columns, input.rows);
    else if (input.action === "retrySharing") await piExtensionTerminalHost.retrySharing(input.id);
    else if (input.action === "review") piExtensionTerminalHost.review(input.id);
    else if (input.action === "stop") piExtensionTerminalHost.stop(input.id);
    else throw new Error("Unsupported terminal action.");
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Terminal operation failed." }, { status: 400 });
  }
};
