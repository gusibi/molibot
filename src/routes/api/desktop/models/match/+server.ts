import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { ModelRegistryService } from "$lib/server/providers/modelRegistry";

export const GET: RequestHandler = async ({ url }) => {
  const query = String(url.searchParams.get("query") ?? url.searchParams.get("id") ?? "").trim();
  const refresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true";

  const registry = ModelRegistryService.getInstance();
  await registry.ensureLoaded(refresh);

  if (!query) {
    return json({ ok: true, matched: false, message: "Query parameter is required" });
  }

  const inferred = registry.inferModelCapabilities(query);
  return json({
    ok: true,
    ...inferred
  }, {
    headers: { "Cache-Control": "no-store" }
  });
};
