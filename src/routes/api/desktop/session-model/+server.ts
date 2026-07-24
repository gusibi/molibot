import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { isValidSessionTextModelKey } from "$lib/server/app/desktopModels";
import type {
  DesktopSessionModelResponse,
  DesktopSessionModelUpdateRequest
} from "$lib/shared/desktop";

/** Reads a session's persisted per-session text-model override. */
export const GET: RequestHandler = async ({ url }) => {
  const conversationId = String(url.searchParams.get("conversationId") ?? "").trim();
  if (!conversationId) {
    return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  }
  const runtime = getRuntime();
  const payload: DesktopSessionModelResponse = {
    ok: true,
    modelKey: runtime.sessions.getConversationModelKey(conversationId)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

/** Persists a session's per-session text-model override (empty string clears it). */
export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopSessionModelUpdateRequest;
  try {
    body = (await request.json()) as DesktopSessionModelUpdateRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) {
    return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  }

  const modelKey = String(body.modelKey ?? "").trim();
  const runtime = getRuntime();
  if (!isValidSessionTextModelKey(runtime.getSettings(), modelKey)) {
    return json({ ok: false, error: `Invalid model selector: ${modelKey}` }, { status: 400 });
  }

  const conversation = runtime.sessions.setConversationModelKey(conversationId, modelKey);
  if (!conversation) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }

  const payload: DesktopSessionModelResponse = { ok: true, modelKey: conversation.modelKey ?? "" };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
