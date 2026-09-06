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
import { resolveRunnerChatId } from "$lib/server/web/runtimeContext";
import { buildHostBashApprovalPrompt, type HostBashApprovalMode, type HostBashApprovalStatus } from "$lib/server/hostBash/index";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker";
import { listDesktopBrokerApprovals, resolveDesktopBrokerApproval } from "$lib/server/app/desktopApprovals";
import { resumeSuspendedBrokerApproval } from "$lib/server/channels/shared/brokerApprovalResume";
import { getWebRuntimeContext } from "$lib/server/web/runtimeContext";
import { _handleWebHostToolsCommand } from "../../chat/+server";

const APPROVAL_SUBCOMMANDS: Record<DesktopApprovalDecision, string> = {
  approve_once: "approve-once",
  approve_session: "approve-session",
  approve_persistent: "approve",
  reject: "reject"
};

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const hostBashStore = runtime.hostBashStore;
  const statusParam = String(url.searchParams.get("status") ?? "all").trim();
  const modeParam = String(url.searchParams.get("mode") ?? "all").trim();
  const categoryParam = String(url.searchParams.get("category") ?? "all").trim();
  const query = String(url.searchParams.get("query") ?? "").trim();

  const status = (
    statusParam === "approved" ||
    statusParam === "rejected" ||
    statusParam === "executed" ||
    statusParam === "failed" ||
    statusParam === "expired" ||
    statusParam === "all"
  ) ? statusParam as HostBashApprovalStatus | "all" : "all";

  const approvalMode = (
    modeParam === "persistent" ||
    modeParam === "ephemeral" ||
    modeParam === "session" ||
    modeParam === "all"
  ) ? modeParam as HostBashApprovalMode | "all" : "all";

  const category = (
    categoryParam === "bash" ||
    categoryParam === "mcp" ||
    categoryParam === "file_write" ||
    categoryParam === "miniapp" ||
    categoryParam === "all"
  ) ? categoryParam as any : "all";

  const pending = hostBashStore.listPending(undefined, undefined, category);
  const whitelist = hostBashStore.listWhitelist(category);
  const history = hostBashStore.listHistory({ status, approvalMode, category, query });

  const summary = buildDesktopHostBashSummary({ pending, whitelist, history });
  return json({
    ok: true,
    summary,
    pending,
    whitelist,
    history,
    counts: {
      pending: pending.length,
      whitelist: whitelist.length,
      whitelistEnabled: whitelist.filter((item) => item.enabled).length,
      history: history.length
    }
  }, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { action?: string; id?: string; enabled?: boolean; profileId?: string; sessionId?: string; requestId?: string; decision?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  /**
   * Operator resolution: resolve a pending approval by ID alone, without a
   * profile/session context. The settings page lists every scope's approvals
   * (the GET above is already the operator surface), so it can act on records
   * from sessions nobody currently has open — the exact state a missed approval
   * card leaves behind. Web-scoped records resume through the same machinery
   * the chat card uses; other channels must resolve in their own channel.
   */
  if (body.action === "resolve_approval" && !body.sessionId && !body.profileId) {
    const requestId = String(body.requestId ?? "").trim();
    const decision = String(body.decision ?? "") as DesktopApprovalDecision;
    if (!requestId || !Object.hasOwn(APPROVAL_SUBCOMMANDS, decision)) {
      return json({ ok: false, error: "requestId and a valid decision are required" }, { status: 400 });
    }
    const runtime = getRuntime();
    const record = runtime.hostBashStore.listPending().find((item) => item.id === requestId);
    if (!record) {
      return json({
        ok: true,
        response: "No matching pending Host Bash approval found.",
        approval: { status: "not_found" }
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!record.scopeId.startsWith("web:")) {
      if (decision === "reject") {
        const rejected = runtime.hostBashStore.reject(record.scopeId, requestId, record.sessionId);
        return json({
          ok: true,
          response: rejected
            ? `Rejected Host Bash approval ${rejected.id} (${rejected.displayName}).`
            : "No matching pending Host Bash approval found.",
          approval: { status: rejected ? "rejected" : "not_found" }
        }, { headers: { "Cache-Control": "no-store" } });
      }
      return json({
        ok: true,
        response: "This approval was raised on another channel; approve or reject it from that channel's chat.",
        approval: { status: "not_found" }
      }, { headers: { "Cache-Control": "no-store" } });
    }
    // web:<profileId>:<user…> — the same scope string the web runner is keyed by.
    const profileId = sanitizeWebProfileId(record.scopeId.split(":")[1]);
    const result = await _handleWebHostToolsCommand(
      `${APPROVAL_SUBCOMMANDS[decision]} ${requestId}`,
      sanitizeWebProfileId(profileId),
      record.sessionId || undefined,
      record.scopeId
    );
    return json(result, { headers: { "Cache-Control": "no-store" } });
  }

  /**
   * Pending approvals for one session.
   *
   * The approval card is normally pushed over the chat SSE stream, but a turn
   * resumed *by* an approval runs in the background with no stream attached —
   * so a second approval raised during that resumed turn reached nobody and the
   * user had to type "批准" by hand. Desktop polls this while it waits for a
   * resumed turn so it can render the card it was never sent.
   */
  if (body.action === "list_pending") {
    const profileId = sanitizeWebProfileId(body.profileId);
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) {
      return json({ ok: false, error: "sessionId is required" }, { status: 400 });
    }
    const runtime = getRuntime();
    const owner = runtime.sessions.getWebConversationOwner(sessionId);
    if (owner?.startsWith(`web:${profileId}:`) === false) {
      return json({ ok: false, error: "Session does not belong to the selected profile" }, { status: 403 });
    }
    const externalUserId = owner ?? toWebExternalUserId("web-anonymous", profileId);
    const scopeId = resolveRunnerChatId(sessionId, externalUserId);
    // listPending ORs scope and session, so narrow to this session explicitly —
    // another session in the same scope must not steal this one's card.
    const hostBashApprovals = runtime.hostBashStore
      .listPending(scopeId, sessionId)
      .filter((record) => !record.sessionId || record.sessionId === sessionId)
      .map((record) => buildHostBashApprovalPrompt(record));
    const brokerApprovals = listDesktopBrokerApprovals(getApprovalBroker(), sessionId);
    const approvals = [...hostBashApprovals, ...brokerApprovals];
    return json({ ok: true, approvals }, { headers: { "Cache-Control": "no-store" } });
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
    const brokerResolution = resolveDesktopBrokerApproval(getApprovalBroker(), { sessionId, requestId, decision });
    if (brokerResolution) {
      const status = brokerResolution.status;
      const externalUserId = owner ?? toWebExternalUserId("web-anonymous", profileId);
      const scopeId = resolveRunnerChatId(sessionId, externalUserId);
      const { store, pool } = getWebRuntimeContext(profileId);
      void resumeSuspendedBrokerApproval({
        scopeId,
        sessionId,
        requestId,
        status,
        store,
        pool,
        channel: "web"
      });
      return json({
        ok: true,
        response: status === "approved"
          ? `Approved tool request ${requestId}.`
          : `Rejected tool request ${requestId}.`,
        approval: { status }
      }, { headers: { "Cache-Control": "no-store" } });
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

  if (body.action === "toggle_whitelist") {
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
  }

  if (body.action === "delete_whitelist") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const runtime = getRuntime();
    const deleted = runtime.hostBashStore.deleteWhitelistEntry(id);
    if (!deleted) return json({ ok: false, error: "Whitelist entry not found" }, { status: 404 });
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  if (body.action === "delete_history") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id is required" }, { status: 400 });
    const runtime = getRuntime();
    const deleted = runtime.hostBashStore.deleteHistoryRecord(id);
    if (!deleted) return json({ ok: false, error: "History record not found" }, { status: 404 });
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  return json({ ok: false, error: "Unsupported action" }, { status: 400 });
};
