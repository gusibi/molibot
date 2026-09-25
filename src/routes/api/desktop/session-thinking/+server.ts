import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { getRuntimeContextForConversation, resolveRunnerChatId } from "$lib/server/web/runtimeContext";
import { sanitizeWebProfileId, toWebExternalUserId } from "$lib/server/web/identity";
import { sanitizeOptionalRuntimeThinkingSelection, type RuntimeThinkingSelection } from "$lib/server/settings";
import { readAdaptiveThinkingAvailability } from "$lib/server/settings/handlers/adaptiveThinking.js";
import type {
  DesktopSessionThinkingResponse,
  DesktopSessionThinkingUpdateRequest
} from "$lib/shared/desktop";

function context(profileId: string, conversationId: string) {
  const runtime = getRuntime();
  const normalizedProfile = sanitizeWebProfileId(profileId);
  const runtimeContext = getRuntimeContextForConversation(normalizedProfile, conversationId);
  const fallback = toWebExternalUserId("web-anonymous", normalizedProfile);
  const chatId = resolveRunnerChatId(conversationId, fallback);
  return { runtime, runtimeContext, chatId };
}

export const GET: RequestHandler = async ({ url }) => {
  const profileId = String(url.searchParams.get("profileId") ?? "default");
  const conversationId = String(url.searchParams.get("conversationId") ?? "").trim();
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  const { runtimeContext, chatId } = context(profileId, conversationId);
  const payload: DesktopSessionThinkingResponse = {
    ok: true,
    thinkingLevel: runtimeContext.store.getSessionThinkingLevelOverride(chatId, conversationId)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopSessionThinkingUpdateRequest;
  try {
    body = await request.json() as DesktopSessionThinkingUpdateRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  const profileId = String(body.profileId ?? "default");
  let selection: RuntimeThinkingSelection | null;
  if (body.thinkingLevel === null) {
    selection = null;
  } else {
    const parsed = sanitizeOptionalRuntimeThinkingSelection(body.thinkingLevel);
    if (!parsed) return json({ ok: false, error: "Invalid Thinking selection" }, { status: 400 });
    selection = parsed;
  }
  const { runtime, runtimeContext, chatId } = context(profileId, conversationId);
  if (selection === "auto" && !await readAdaptiveThinkingAvailability(runtime)) {
    return json({ ok: false, error: "Configure and enable a decision model before selecting Auto." }, { status: 400 });
  }
  const applied = runtimeContext.store.setSessionThinkingLevelOverride(chatId, conversationId, selection);
  const payload: DesktopSessionThinkingResponse = { ok: true, thinkingLevel: applied };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
