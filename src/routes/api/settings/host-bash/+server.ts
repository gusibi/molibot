import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import type { HostBashApprovalMode, HostBashApprovalStatus } from "$lib/server/hostBash";

interface ToggleWhitelistBody {
  action?: "toggle_whitelist";
  id?: string;
  enabled?: boolean;
}

interface DeleteWhitelistBody {
  action?: "delete_whitelist";
  id?: string;
}

interface DeleteHistoryBody {
  action?: "delete_history";
  id?: string;
}

type HostBashMutationBody = ToggleWhitelistBody | DeleteWhitelistBody | DeleteHistoryBody;

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const hostBashStore = runtime.hostBashStore;
  const statusParam = String(url.searchParams.get("status") ?? "all").trim();
  const modeParam = String(url.searchParams.get("mode") ?? "all").trim();
  const query = String(url.searchParams.get("query") ?? "").trim();

  const status = (
    statusParam === "approved" ||
    statusParam === "rejected" ||
    statusParam === "executed" ||
    statusParam === "failed" ||
    statusParam === "all"
  ) ? statusParam as HostBashApprovalStatus | "all" : "all";

  const approvalMode = (
    modeParam === "persistent" ||
    modeParam === "ephemeral" ||
    modeParam === "session" ||
    modeParam === "all"
  ) ? modeParam as HostBashApprovalMode | "all" : "all";

  const pending = hostBashStore.listPending();
  const whitelist = hostBashStore.listWhitelist();
  const history = hostBashStore.listHistory({ status, approvalMode, query });

  return json({
    ok: true,
    pending,
    whitelist,
    history,
    counts: {
      pending: pending.length,
      whitelist: whitelist.length,
      whitelistEnabled: whitelist.filter((item) => item.enabled).length,
      history: history.length
    }
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const runtime = getRuntime();
  const hostBashStore = runtime.hostBashStore;
  const body = await request.json() as HostBashMutationBody;

  if (body.action === "toggle_whitelist") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const entry = hostBashStore.setWhitelistEnabled(id, Boolean(body.enabled));
    if (!entry) return json({ ok: false, error: "Whitelist entry not found" }, { status: 404 });
    return json({ ok: true, entry });
  }

  if (body.action === "delete_whitelist") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const deleted = hostBashStore.deleteWhitelistEntry(id);
    if (!deleted) return json({ ok: false, error: "Whitelist entry not found" }, { status: 404 });
    return json({ ok: true });
  }

  if (body.action === "delete_history") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const deleted = hostBashStore.deleteHistoryRecord(id);
    if (!deleted) return json({ ok: false, error: "History record not found" }, { status: 404 });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unsupported action" }, { status: 400 });
};
