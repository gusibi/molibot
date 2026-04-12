import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { readRunHistory } from "$lib/server/agent/reviewData";

export const GET: RequestHandler = async ({ url }) => {
  const dataRoot = resolve(config.dataDir);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 200) || 200));
  const { items, diagnostics } = readRunHistory(dataRoot, limit);

  const counts = {
    total: items.length,
    success: items.filter((item) => item.reflectionOutcome === "success").length,
    partial: items.filter((item) => item.reflectionOutcome === "partial").length,
    failed: items.filter((item) => item.reflectionOutcome === "failed").length
  };

  return json({
    ok: true,
    dataRoot,
    items,
    diagnostics,
    counts
  });
};
