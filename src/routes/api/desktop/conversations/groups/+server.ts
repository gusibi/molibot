import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { listDesktopConversationGroups } from "$lib/server/app/desktopConversations.js";
import type {
  DesktopConversationChannel,
  DesktopConversationsGroupsResponse
} from "$lib/shared/desktop.js";

const CHANNELS: DesktopConversationChannel[] = ["web", "telegram", "feishu", "qq", "weixin"];

function parseChannel(raw: string | null): DesktopConversationChannel {
  const value = String(raw ?? "web");
  return (CHANNELS as string[]).includes(value) ? (value as DesktopConversationChannel) : "web";
}

/**
 * Per-Bot grouped view for the "more conversations" browser (plan §5.2 / §5.3).
 * Each group returns its own first page + cursor so a single Bot can be paged
 * independently via `GET /api/desktop/conversations?botId=...&cursor=...`
 * without re-fetching the other groups.
 */
export const GET: RequestHandler = async ({ url }) => {
  const channel = parseChannel(url.searchParams.get("channel"));
  const query = url.searchParams.get("query") || "";

  const result = listDesktopConversationGroups({ channel, query });

  const payload: DesktopConversationsGroupsResponse = {
    ok: true,
    channel,
    groups: result.groups
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
