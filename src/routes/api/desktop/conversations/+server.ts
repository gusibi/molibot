import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import {
  listDesktopConversations,
  renameDesktopConversation,
  deleteDesktopConversation
} from "$lib/server/app/desktopConversations.js";
import type {
  DesktopConversationChannel,
  DesktopConversationsResponse
} from "$lib/shared/desktop.js";

const CHANNELS: DesktopConversationChannel[] = ["web", "telegram", "feishu", "qq", "weixin"];

function parseChannel(raw: string | null): DesktopConversationChannel {
  const value = String(raw ?? "web");
  return (CHANNELS as string[]).includes(value) ? (value as DesktopConversationChannel) : "web";
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : undefined;
}

/**
 * Unified desktop conversation query (plan §12.2). Aggregates ordinary
 * conversation sessions across all Bots for a channel, newest-first, with
 * stable cursor pagination and title/Bot/preview search. Channel layer stays
 * messaging-only; aggregation/filtering lives in the shared query layer.
 */
export const GET: RequestHandler = async ({ url }) => {
  const channel = parseChannel(url.searchParams.get("channel"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor") || null;
  const query = url.searchParams.get("query") || "";
  const botId = url.searchParams.get("botId") || "";

  const result = listDesktopConversations({
    channel,
    limit,
    cursor,
    query,
    botId: botId || undefined
  });

  const payload: DesktopConversationsResponse = {
    ok: true,
    channel,
    items: result.items,
    nextCursor: result.nextCursor,
    hasMore: result.hasMore
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

/**
 * Renames a Web conversation from the sidebar row menu. Web-only: external
 * channels are read-only mirrors, so their rows never surface this action.
 */
export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; title?: unknown } | null;
  const sessionId = String(body?.sessionId ?? "").trim();
  const title = String(body?.title ?? "").trim();
  if (!sessionId || !title) {
    return json({ ok: false, error: "sessionId and title are required" }, { status: 400 });
  }
  const result = renameDesktopConversation(sessionId, title);
  if (!result) {
    return json({ ok: false, error: "conversation not found" }, { status: 404 });
  }
  return json({ ok: true, title: result.title }, { headers: { "Cache-Control": "no-store" } });
};

/**
 * Deletes a Web conversation from the sidebar row menu (Web-only).
 */
export const DELETE: RequestHandler = async ({ url }) => {
  const sessionId = String(url.searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) {
    return json({ ok: false, error: "sessionId is required" }, { status: 400 });
  }
  const ok = deleteDesktopConversation(sessionId);
  if (!ok) {
    return json({ ok: false, error: "conversation not found" }, { status: 404 });
  }
  return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
};
