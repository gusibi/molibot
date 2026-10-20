import { requireEnabledAgent } from "$lib/server/sessions/sessionAgentService.js";
import { resolveExecutionIdentity } from "$lib/server/sessions/executionIdentity.js";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";

interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  parentSessionId?: string;
  forkedFromMessageId?: string;
}

export const GET: RequestHandler = async ({ url }) => {
  const userId = sanitizeWebUserId(url.searchParams.get("userId"));
  const profileId = sanitizeWebProfileId(url.searchParams.get("profileId"));
  const externalUserId = toWebExternalUserId(userId, profileId);
  const { sessions } = getRuntime();
  const listRaw = sessions.listConversations("web", externalUserId);

  const list: SessionSummary[] = listRaw.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    title: s.title || "New Session",
    parentSessionId: s.parentSessionId,
    forkedFromMessageId: s.forkedFromMessageId
  }));

  return json({ ok: true, sessions: list });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { userId?: string; profileId?: string; agentId?: string };
  try {
    body = (await request.json()) as { userId?: string; profileId?: string; agentId?: string };
  } catch {
    body = {};
  }

  const userId = sanitizeWebUserId(body.userId);
  const profileId = sanitizeWebProfileId(body.profileId);
  const externalUserId = toWebExternalUserId(userId, profileId);
  const { sessions, getSettings } = getRuntime();
  let agentId: string;
  try {
    agentId = resolveExecutionIdentity(getSettings(), {
      channel: "web",
      botId: profileId,
      assertedAgentId: body.agentId
    }).agentId;
    requireEnabledAgent(getSettings(), agentId);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 });
  }
  const { conversation: session, reused } = sessions.getOrCreateEmptyWebConversation(externalUserId, agentId);

  return json({
    ok: true,
    session: {
      id: session.id,
      agentId: session.agentId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      title: session.title || "New Session"
    },
    reused
  });
};
