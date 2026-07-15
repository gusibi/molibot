import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopHostBashSummary, buildDesktopHostBashWhitelistItem } from "$lib/server/app/desktopHostBash";
import type {
  DesktopApprovalDecision,
  DesktopHostBashResponse,
  DesktopHostBashToggleResponse
} from "$lib/shared/desktop";
import { sanitizeWebProfileId, toWebExternalUserId } from "$lib/server/web/identity";
import { _handleWebHostToolsCommand } from "../../chat/+server";

const APPROVAL_SUBCOMMANDS: Record<DesktopApprovalDecision, string> = {
  approve_once: "approve-once",
  approve_session: "approve-session",
  approve_persistent: "approve",
  reject: "reject"
};

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
  let body: { action?: string; id?: string; enabled?: boolean; profileId?: string; sessionId?: string; requestId?: string; decision?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "resolve_approval") {
    const profileId = sanitizeWebProfileId(body.profileId);
    const sessionId = String(body.sessionId ?? "").trim();
    const requestId = String(body.requestId ?? "").trim();
    const decision = String(body.decision ?? "") as DesktopApprovalDecision;
    if (!sessionId || !requestId || !Object.hasOwn(APPROVAL_SUBCOMMANDS, decision)) {
      return json({ ok: false, error: "profileId, sessionId, requestId, and a valid decision are required" }, { status: 400 });
    }
    const runtime = getRuntime();
    const owner = runtime.sessions.getWebConversationOwner(sessionId);
    if (owner?.startsWith(`web:${profileId}:`) === false) {
      return json({ ok: false, error: "Session does not belong to the selected profile" }, { status: 403 });
    }
    const externalUserId = owner ?? toWebExternalUserId("web-anonymous", profileId);
    const result = await _handleWebHostToolsCommand(
      `${APPROVAL_SUBCOMMANDS[decision]} ${requestId}`,
      profileId,
      sessionId,
      externalUserId
    );
    return json(result, { headers: { "Cache-Control": "no-store" } });
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
