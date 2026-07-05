import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { listMcpServers, replaceMcpServers } from "$lib/server/settings/handlers/mcp";

export const GET: RequestHandler = async () => {
  try {
    const servers = listMcpServers(getRuntime());
    return json({ ok: true, mcpServers: servers });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { mcpServers?: unknown } | unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body && typeof body === "object" && "mcpServers" in (body as Record<string, unknown>)
    ? (body as { mcpServers: unknown }).mcpServers
    : body;

  try {
    const { servers } = replaceMcpServers(getRuntime(), payload);
    return json({ ok: true, mcpServers: servers });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};
