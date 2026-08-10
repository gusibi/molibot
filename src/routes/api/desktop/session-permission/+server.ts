import { basename } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { resolveEffectivePermissionMode } from "$lib/server/agent/permissions/resolvePermissionMode";
import { PERMISSION_MODES } from "$lib/server/agent/permissions/decidePermission";
import { getRuntimeContextForConversation, resolveRunnerChatId } from "$lib/server/web/runtimeContext";
import { sanitizeWebProfileId, toWebExternalUserId } from "$lib/server/web/identity";
import type { DesktopPlanDecisionRequest, DesktopSessionPermissionUpdateRequest } from "$lib/shared/desktop";

function context(profileId: string, conversationId: string) {
  const runtime = getRuntime();
  const normalizedProfile = sanitizeWebProfileId(profileId);
  const runtimeContext = getRuntimeContextForConversation(normalizedProfile, conversationId);
  const fallback = toWebExternalUserId("web-anonymous", normalizedProfile);
  const chatId = resolveRunnerChatId(conversationId, fallback);
  return { runtime, normalizedProfile, runtimeContext, chatId };
}

export const GET: RequestHandler = async ({ url }) => {
  const profileId = String(url.searchParams.get("profileId") ?? "default");
  const conversationId = String(url.searchParams.get("conversationId") ?? "").trim();
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  const { runtime, normalizedProfile, runtimeContext, chatId } = context(profileId, conversationId);
  const mode = resolveEffectivePermissionMode({
    getSettings: runtime.getSettings,
    chatId,
    sessionId: conversationId,
    store: runtimeContext.store,
    channel: "web",
    botId: basename(runtimeContext.store.getWorkspaceDir()) || normalizedProfile
  });
  return json({ ok: true, mode }, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopSessionPermissionUpdateRequest | DesktopPlanDecisionRequest;
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const conversationId = String(body.conversationId ?? "").trim();
  const profileId = String(body.profileId ?? "default");
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  const { runtimeContext, chatId, runtime } = context(profileId, conversationId);

  if ("planId" in body) {
    const decision = body.decision;
    if (!["accept", "reject", "modify"].includes(decision)) return json({ ok: false, error: "Invalid plan decision" }, { status: 400 });
    const plan = runtime.sessions.updateConversationPlan(conversationId, body.planId, (current) => ({
      ...current,
      title: String(body.title ?? current.title).trim() || current.title,
      summary: String(body.summary ?? current.summary).trim() || current.summary,
      steps: Array.isArray(body.steps) && body.steps.length
        ? body.steps.slice(0, 30).map((text, index) => ({
            id: current.steps[index]?.id ?? `${current.id}-${index + 1}`,
            text: String(text).trim(),
            status: current.steps[index]?.status ?? "pending"
          }))
        : current.steps,
      status: decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "proposed"
    }));
    if (!plan) return json({ ok: false, error: "Plan not found" }, { status: 404 });
    if (decision === "accept") {
      const mode = body.mode === "manual" ? "manual" : "accept_edits";
      runtimeContext.store.setSessionPermissionModeOverride(chatId, conversationId, mode);
      return json({ ok: true, plan, mode }, { headers: { "Cache-Control": "no-store" } });
    }
    if (decision === "modify") return json({ ok: true, plan, mode: "plan" }, { headers: { "Cache-Control": "no-store" } });
    return json({ ok: true, plan, mode: "plan" }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!PERMISSION_MODES.includes(body.mode)) return json({ ok: false, error: "Invalid permission mode" }, { status: 400 });
  runtimeContext.store.setSessionPermissionModeOverride(chatId, conversationId, body.mode);
  return json({ ok: true, mode: body.mode }, { headers: { "Cache-Control": "no-store" } });
};
