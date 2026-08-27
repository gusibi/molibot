import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { searchDesktopConversations } from "$lib/server/app/desktopConversations.js";
import type {
  DesktopConversationSearchResponse,
  DesktopConversationSearchScope
} from "$lib/shared/desktop.js";

const SCOPES: DesktopConversationSearchScope[] = [
  "all", "web", "project", "channels", "telegram", "feishu", "qq", "weixin"
];

function parseScope(raw: string | null): DesktopConversationSearchScope {
  const value = String(raw ?? "all");
  return (SCOPES as string[]).includes(value) ? value as DesktopConversationSearchScope : "all";
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : undefined;
}

export const GET: RequestHandler = ({ url }) => {
  const result = searchDesktopConversations({
    scope: parseScope(url.searchParams.get("scope")),
    query: url.searchParams.get("query") || "",
    limit: parseLimit(url.searchParams.get("limit")),
    cursor: url.searchParams.get("cursor") || null
  });
  const payload: DesktopConversationSearchResponse = { ok: true, ...result };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
