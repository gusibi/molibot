import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getProjectStore } from "$lib/server/projects/store.js";

export const GET: RequestHandler = ({ params }) => {
  if (!getProjectStore().get(params.id)) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const sessions = getRuntime().sessions.listProjectConversations(params.id).map((conversation) => ({
    conversationId: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    origin: conversation.origin ?? conversation.externalUserId
  }));
  return json({ ok: true, sessions });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!getProjectStore().get(params.id)) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { externalUserId?: string };
  const externalUserId = String(body.externalUserId ?? "web:personal:web-anonymous").trim();
  const { conversation, reused } = getRuntime().sessions.getOrCreateEmptyProjectConversation(params.id, externalUserId);
  return json({
    ok: true,
    session: {
      conversationId: conversation.id,
      title: conversation.title || "New Session",
      updatedAt: conversation.updatedAt,
      origin: conversation.origin ?? conversation.externalUserId
    },
    reused
  }, { status: reused ? 200 : 201 });
};
