import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/runtime";

interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
}

export const GET: RequestHandler = async ({ url }) => {
  const userId = url.searchParams.get("userId")?.trim() || "web-anonymous";
  const { sessions } = getRuntime();
  const listRaw = sessions.listConversations("web", userId);

  const list: SessionSummary[] = listRaw.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    title: s.title || "New Session"
  }));

  return json({ ok: true, sessions: list });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { userId?: string };
  try {
    body = (await request.json()) as { userId?: string };
  } catch {
    body = {};
  }

  const userId = body.userId?.trim() || "web-anonymous";
  const { sessions } = getRuntime();
  const session = sessions.createWebConversation(userId);

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
