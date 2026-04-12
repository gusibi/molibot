import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { readMemoryGovernanceRejections } from "$lib/server/memory/governanceLog";

export const GET: RequestHandler = async ({ url }) => {
  const dataRoot = resolve(config.dataDir);
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") ?? 300) || 300));
  const filePath = resolve(dataRoot, "memory-governance", "rejections.jsonl");
  const { items, diagnostics } = readMemoryGovernanceRejections(filePath, limit);

  return json({
    ok: true,
    dataRoot,
    filePath,
    items,
    diagnostics,
    counts: {
      total: items.length,
      add: items.filter((item) => item.action === "add").length,
      update: items.filter((item) => item.action === "update").length
    }
  });
};
