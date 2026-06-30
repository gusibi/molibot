import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopHostBashSummary, buildDesktopHostBashWhitelistItem } from "$lib/server/app/desktopHostBash";
import type {
  DesktopHostBashResponse,
  DesktopHostBashToggleResponse
} from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const hostBashStore = runtime.hostBashStore;
  const pending = hostBashStore.listPending();
  const whitelist = hostBashStore.listWhitelist();
  const history = hostBashStore.listHistory({ status: "all", approvalMode: "all", query: "" });

  const summary = buildDesktopHostBashSummary({ pending, whitelist, history });
  const payload: DesktopHostBashResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { action?: string; id?: string; enabled?: boolean };
  try {
    body = (await request.json()) as { action?: string; id?: string; enabled?: boolean };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "toggle_whitelist") {
    return json({ ok: false, error: "Unsupported action" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) {
    return json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const runtime = getRuntime();
  const entry = runtime.hostBashStore.setWhitelistEnabled(id, Boolean(body.enabled));
  if (!entry) {
    return json({ ok: false, error: "Whitelist entry not found" }, { status: 404 });
  }

  const payload: DesktopHostBashToggleResponse = { ok: true, entry: buildDesktopHostBashWhitelistItem(entry) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
