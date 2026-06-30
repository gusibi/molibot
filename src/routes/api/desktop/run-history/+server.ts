import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolve } from "node:path";
import { config } from "$lib/server/app/env";
import { readRunHistory } from "$lib/server/agent/session/reviewData";
import {
  buildDesktopRunHistoryCounts,
  buildDesktopRunHistoryItem
} from "$lib/server/app/desktopRunHistory";
import type { DesktopRunHistoryResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 200) || 200));
  const { items } = readRunHistory(resolve(config.dataDir), limit);
  const desktopItems = items.map(buildDesktopRunHistoryItem);
  const payload: DesktopRunHistoryResponse = {
    ok: true,
    items: desktopItems,
    counts: buildDesktopRunHistoryCounts(desktopItems)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
