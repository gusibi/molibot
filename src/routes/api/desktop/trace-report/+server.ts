import { json, type RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import { isTraceViewerEnabled } from "$lib/server/plugins/traceViewer/plugin.js";
import { queryTurnTraceReport, publicTraceReport } from "$lib/server/plugins/traceViewer/report.js";
import { renderTraceReport } from "$lib/server/plugins/traceViewer/render.js";
import { publishHtmlDocument } from "$lib/server/plugins/cloudflareHtml/publishHtmlTool.js";
import { resolveCloudflareHtmlConfig } from "$lib/server/plugins/cloudflareHtml/config.js";

export const GET: RequestHandler = async ({ url }) => {
  const enabled = isTraceViewerEnabled(getRuntime().getSettings());
  if (!url.searchParams.has("runId")) return json({ ok: true, enabled }, { headers: { "Cache-Control": "no-store" } });
  if (!enabled) return json({ ok: false, error: "Call Trace plugin is disabled." }, { status: 403 });
  const store = new SqliteTraceStore();
  try {
    const report = queryTurnTraceReport(store, url.searchParams.getAll("runId"));
    const html = renderTraceReport(report, url.searchParams.get("language") === "en" ? "en" : "zh");
    return json({ ok: true, html, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : "Trace unavailable." }, { status: 404 });
  } finally { store.close(); }
};

export const POST: RequestHandler = async ({ request }) => {
  const settings = getRuntime().getSettings();
  if (!isTraceViewerEnabled(settings)) return json({ ok: false, error: "Call Trace plugin is disabled." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.runIds) || !body.runIds.every((id: unknown) => typeof id === "string")) return json({ ok: false, error: "runIds are required." }, { status: 400 });
  const store = new SqliteTraceStore();
  try {
    const report = publicTraceReport(queryTurnTraceReport(store, body.runIds));
    const result = await publishHtmlDocument(resolveCloudflareHtmlConfig(settings), renderTraceReport(report, body.language === "en" ? "en" : "zh"));
    return json({ ok: true, url: result.url });
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : "Publishing failed." }, { status: 400 });
  } finally { store.close(); }
};
