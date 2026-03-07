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
    title: s.title || "New Session"
  }));

  return json({ ok: true, sessions: list });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { userId?: string; profileId?: string };
  try {
    body = (await request.json()) as { userId?: string; profileId?: string };
  } catch {
    body = {};
  }

  const userId = sanitizeWebUserId(body.userId);
  const profileId = sanitizeWebProfileId(body.profileId);
  const externalUserId = toWebExternalUserId(userId, profileId);
  const { sessions } = getRuntime();
  const session = sessions.createWebConversation(externalUserId);

  return json({
    ok: true,
    session: {
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      title: session.title || "New Session"
    }
  });
};
