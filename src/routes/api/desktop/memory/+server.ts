import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMemorySummary } from "$lib/server/app/desktopMemory";
import type { DesktopMemoryResponse } from "$lib/shared/desktop";
import type { DesktopMemoryActionRequest, DesktopMemoryActionResponse, DesktopMemoryRejectionsResponse } from "$lib/shared/desktop";
import { resolve } from "node:path";
import { config } from "$lib/server/app/env";
import { readMemoryGovernanceRejections } from "$lib/server/memory/governanceLog";
import { readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts";

export const GET: RequestHandler = async ({ url }) => {
  if (url.searchParams.get("view") === "rejections") {
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") ?? 300) || 300));
    const { items } = readMemoryGovernanceRejections(resolve(config.dataDir, "memory-governance", "rejections.jsonl"), limit);
    const payload: DesktopMemoryRejectionsResponse = { ok: true, items, counts: { total: items.length, add: items.filter((item) => item.action === "add").length, update: items.filter((item) => item.action === "update").length } };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  }
  const runtime = getRuntime();
  const summary = buildDesktopMemorySummary(runtime.getSettings(), {
    enabled: runtime.memory.isEnabled(),
    capabilities: runtime.memory.capabilities()
  });
  const payload: DesktopMemoryResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

function memoryScope(body: DesktopMemoryActionRequest): { channel: string; externalUserId: string } {
  return { channel: String(body.channel ?? "web").trim() || "web", externalUserId: String(body.userId ?? "web-anonymous").trim() || "web-anonymous" };
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as DesktopMemoryActionRequest;
    const memory = getRuntime().memory;
    const scope = memoryScope(body);
    let payload: DesktopMemoryActionResponse;
    if (body.action === "list-candidates") {
      payload = { ok: true, candidates: memory.listCandidates("pending", body.limit ?? 200) };
    } else if (body.action === "confirm-candidate") {
      if (!body.id?.trim()) throw new Error("id is required");
      payload = { ok: true, candidate: await memory.confirmCandidate(body.id.trim(), {
        value: body.content,
        namespace: body.namespace as any,
        domain: body.domain,
        type: body.type as any,
        subject: body.subject,
        confidence: body.confidence,
        reason: body.reason
      }) };
    } else if (body.action === "ignore-candidate") {
      if (!body.id?.trim()) throw new Error("id is required");
      payload = { ok: true, candidate: memory.ignoreCandidate(body.id.trim()) };
    } else if (body.action === "source") {
      if (!body.sessionId?.trim() || !body.messageId?.trim()) throw new Error("sessionId and messageId are required");
      const runtime = getRuntime();
      const local = runtime.sessions.listMessages(body.sessionId.trim());
      const messages = local.length > 0 ? local : (readExternalTranscriptFromContexts(config.dataDir, body.sessionId.trim())?.messages ?? []);
      payload = { ok: true, sourceMessages: messages.map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt, selected: message.id === body.messageId!.trim() })) };
    } else if (body.action === "versions") {
      if (!body.id?.trim()) throw new Error("id is required");
      payload = { ok: true, versions: await memory.versions(scope, body.id.trim()) };
    } else if (body.action === "backfill-embeddings") {
      payload = { ok: true, result: await memory.backfillEmbeddings(body.limit ?? 100) };
    } else if (body.action === "migrate-json-file") {
      payload = { ok: true, result: await memory.migrateJsonFileToMory() };
    } else if (body.action === "list" || body.action === "search") {
      const query = body.action === "search" ? String(body.query ?? "") : "";
      const items = body.allScopes ? await memory.searchAll({ query, limit: body.limit ?? 200, mode: body.action === "search" ? "hybrid" : "recent" }) : await memory.search(scope, { query, limit: body.limit ?? 200, mode: body.action === "search" ? "hybrid" : "recent" });
      payload = { ok: true, items };
    } else if (body.action === "sync") payload = { ok: true, sync: await memory.syncExternalMemories() as unknown as Record<string, number> };
    else if (body.action === "flush") payload = { ok: true, result: await memory.flush(scope) as unknown as Record<string, number> };
    else if (body.action === "compact") payload = { ok: true, result: (body.allScopes ? await memory.compact() : await memory.compact(scope)) as unknown as Record<string, number> };
    else if (body.action === "delete") {
      if (!body.id?.trim()) throw new Error("id is required");
      payload = { ok: true, deleted: await memory.delete(scope, body.id.trim()) };
    } else if (body.action === "update") {
      if (!body.id?.trim()) throw new Error("id is required");
      const item = await memory.update(scope, body.id.trim(), { content: body.content, tags: body.tags, expiresAt: body.expiresAt === null ? null : body.expiresAt, pinned: body.pinned });
      payload = { ok: true, item };
    } else throw new Error("Unsupported memory action");
    return json(payload);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
