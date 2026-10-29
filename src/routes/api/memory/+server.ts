import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

type MemoryAction = "add" | "search" | "flush" | "delete" | "forget" | "update" | "list" | "sync" | "compact" | "list-candidates" | "confirm-candidate" | "ignore-candidate";

interface MemoryBody {
  action?: MemoryAction;
  channel?: string;
  userId?: string;
  allScopes?: boolean;
  query?: string;
  content?: string;
  tags?: string[];
  expiresAt?: string | null;
  id?: string;
  limit?: number;
  namespace?: string;
  domain?: string;
  type?: string;
  subject?: string;
  confidence?: number;
  reason?: string;
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
  const scope = scopeOf(body);
  const allScopes = Boolean(body.allScopes);

  if (action === "add") {
    if (!String(body.content ?? "").trim()) {
      return json({ ok: false, error: "content is required" }, { status: 400 });
    }
    const item = await memory.add(scope, {
      content: String(body.content),
      tags: Array.isArray(body.tags) ? body.tags : [],
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined
    });
    return json({ ok: true, item, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "search") {
    const items = allScopes
      ? await memory.searchAll({
          query: String(body.query ?? ""),
          limit: body.limit ?? 500,
          mode: "hybrid"
        })
      : await memory.search(scope, {
          query: String(body.query ?? ""),
          limit: body.limit,
          mode: "hybrid"
        });
    return json({ ok: true, items, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "list") {
    const items = allScopes
      ? await memory.searchAll({
          query: "",
          limit: body.limit ?? 500,
          mode: "recent"
        })
      : await memory.search(scope, {
          query: "",
          limit: body.limit ?? 200,
          mode: "recent"
        });
    return json({ ok: true, items, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "flush") {
    const result = await memory.flush(scope);
    return json({ ok: true, result, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "delete") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const deleted = await memory.delete(scope, id);
    return json({ ok: true, deleted, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "forget") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const deleted = await memory.forget(scope, id, { reason: "user_forget" });
    return json({ ok: true, deleted, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "list-candidates") {
    return json({
      ok: true,
      candidates: memory.listCandidates("pending", body.limit ?? 200),
      enabled: memory.isEnabled(),
      capabilities: memory.capabilities()
    });
  }

  if (action === "confirm-candidate") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const candidate = await memory.confirmCandidate(id, {
      value: body.content,
      namespace: body.namespace as any,
      domain: body.domain as any,
      type: body.type as any,
      subject: body.subject,
      confidence: body.confidence,
      reason: body.reason
    });
    return json({ ok: true, candidate, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "ignore-candidate") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    return json({
      ok: true,
      candidate: memory.ignoreCandidate(id),
      enabled: memory.isEnabled(),
      capabilities: memory.capabilities()
    });
  }

  if (action === "update") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const item = await memory.update(scope, id, {
      content: body.content,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      expiresAt: body.expiresAt === null ? null : (typeof body.expiresAt === "string" ? body.expiresAt : undefined)
    });
    return json({ ok: true, item, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "sync") {
    const sync = await memory.syncExternalMemories();
    return json({ ok: true, sync, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  if (action === "compact") {
    const result = allScopes ? await memory.compact() : await memory.compact(scope);
    return json({ ok: true, result, enabled: memory.isEnabled(), capabilities: memory.capabilities() });
  }

  return json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
};
