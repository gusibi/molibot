import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity";

function requesterOf(url: URL): string | undefined {
  if (!url.searchParams.has("userId") && !url.searchParams.has("profileId")) return undefined;
  return toWebExternalUserId(
    sanitizeWebUserId(url.searchParams.get("userId")),
    sanitizeWebProfileId(url.searchParams.get("profileId"))
  );
}

/**
 * T9 extraction status read: derived status plus the exact source range and
 * retained references (memory ids, document refs, pending candidates,
 * failure reasons). Unknown, unauthorized or purged sources return explicit
 * `source-unavailable` — the same contract as the transcript preview and the
 * linked memory/evidence views — instead of crashing or implying failure.
 */
export const GET: RequestHandler = async ({ url }) => {
  const conversationId = String(url.searchParams.get("conversationId") ?? "").trim();
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  try {
    const { sessionExtraction } = getRuntime();
    const described = sessionExtraction.describe({
      conversationId,
      requesterExternalUserId: requesterOf(url)
    });
    if (!described) return json({ ok: false, error: "source-unavailable", conversationId }, { status: 404 });
    return json({ ok: true, extraction: described });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
