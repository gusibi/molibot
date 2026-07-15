import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getProjectStore } from "$lib/server/projects/store.js";

export const GET: RequestHandler = ({ params }) => {
  if (!getProjectStore().get(params.id)) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const conversation = getRuntime().sessions.getProjectConversation(params.id, params.conversationId);
  if (!conversation) return json({ ok: false, error: "Unknown project session" }, { status: 404 });
  return json({ ok: true, conversation, messages: getRuntime().sessions.listMessages(conversation.id) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!getProjectStore().get(params.id)) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { title?: string };
  const title = String(body.title ?? "").trim();
  if (!title) return json({ ok: false, error: "Title is required" }, { status: 400 });
  const conversation = getRuntime().sessions.renameProjectConversation(params.id, params.conversationId, title);
  if (!conversation) return json({ ok: false, error: "Unknown project session" }, { status: 404 });
  return json({ ok: true, conversation });
};

export const DELETE: RequestHandler = ({ params }) => {
  if (!getProjectStore().get(params.id)) return json({ ok: false, error: "Unknown project" }, { status: 404 });
  const deleted = getRuntime().sessions.deleteProjectConversation(params.id, params.conversationId);
  if (!deleted) return json({ ok: false, error: "Unknown project session" }, { status: 404 });
  return json({ ok: true });
};
