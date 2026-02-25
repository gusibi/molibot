import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/runtime";

type MemoryAction = "add" | "search" | "flush" | "delete" | "update" | "list";

interface MemoryBody {
  action?: MemoryAction;
  channel?: string;
  userId?: string;
  query?: string;
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
  id?: string;
  limit?: number;
}

function scopeOf(body: MemoryBody): { channel: string; externalUserId: string } {
  return {
    channel: String(body.channel ?? "web").trim() || "web",
    externalUserId: String(body.userId ?? "web-anonymous").trim() || "web-anonymous"
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: MemoryBody;
  try {
    body = (await request.json()) as MemoryBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (!action) {
    return json({ ok: false, error: "Missing action" }, { status: 400 });
  }

  const { memory } = getRuntime();
  const sync = await memory.syncExternalMemories();
  const scope = scopeOf(body);

  if (action === "add") {
    if (!String(body.content ?? "").trim()) {
      return json({ ok: false, error: "content is required" }, { status: 400 });
    }
    const item = await memory.add(scope, {
      content: String(body.content),
      tags: Array.isArray(body.tags) ? body.tags : [],
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined
    });
    return json({ ok: true, item, sync, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "search") {
    const channel = String(body.channel ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    const items = channel && userId
      ? await memory.search(scope, {
          query: String(body.query ?? ""),
          limit: body.limit,
          mode: "hybrid"
        })
      : await memory.searchAll({
          query: String(body.query ?? ""),
          limit: body.limit ?? 500,
          mode: "hybrid"
        });
    return json({ ok: true, items, sync, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "list") {
    const channel = String(body.channel ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    const items = channel && userId
      ? await memory.search(scope, {
          query: "",
          limit: body.limit ?? 200,
          mode: "recent"
        })
      : await memory.searchAll({
          query: "",
          limit: body.limit ?? 500,
          mode: "recent"
        });
    return json({ ok: true, items, sync, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "flush") {
    const result = await memory.flush(scope);
    return json({ ok: true, result, sync, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "delete") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const deleted = await memory.delete(scope, id);
    return json({ ok: true, deleted, sync, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "update") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const item = await memory.update(scope, id, {
      content: body.content,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      expiresAt: body.expiresAt === null ? null : (typeof body.expiresAt === "string" ? body.expiresAt : undefined)
    });
    return json({ ok: true, item, sync, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  return json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
};
