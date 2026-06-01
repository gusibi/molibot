import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { runWebSearch } from "$lib/server/agent/search/webSearchTool.js";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebSearchSettings } from "$lib/server/settings/sanitize.js";

export const POST: RequestHandler = async ({ request }) => {
  let body: { query?: string; webSearch?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const baseSettings = runtime.getSettings().webSearch;
  const webSearch = sanitizeWebSearchSettings(body.webSearch ?? baseSettings, baseSettings);
  try {
    const result = await runWebSearch({ query: body.query, maxResults: webSearch.maxResults }, webSearch);
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
