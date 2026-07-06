import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";
import { getWebRuntimeContext } from "$lib/server/web/runtimeContext";
import { attachContextThinking } from "$lib/server/app/conversationThinking.js";

export const GET: RequestHandler = async ({ params, url }) => {
  const id = params.id;
  const userId = sanitizeWebUserId(url.searchParams.get("userId"));
  const profileId = sanitizeWebProfileId(url.searchParams.get("profileId"));
  const externalUserId = toWebExternalUserId(userId, profileId);
  if (!id) {
    return json({ ok: false, error: "Session ID is required" }, { status: 400 });
  }

  const { sessions } = getRuntime();
  const conversation = sessions.getConversationById(id, "web", externalUserId);
  if (!conversation) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }

  const { store } = getWebRuntimeContext(profileId);
  const messages = attachContextThinking(
    sessions.listMessages(id, 1000),
    store.loadContext(externalUserId, id)
  );
  return json({
    ok: true,
    session: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages
    }
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  if (!id) {
    return json({ ok: false, error: "Session ID is required" }, { status: 400 });
  }

  let body: { userId?: string; profileId?: string; title?: string };
  try {
    body = (await request.json()) as { userId?: string; profileId?: string; title?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = sanitizeWebUserId(body.userId);
  const profileId = sanitizeWebProfileId(body.profileId);
  const externalUserId = toWebExternalUserId(userId, profileId);
  const title = String(body.title ?? "").trim();
  if (!title) {
    return json({ ok: false, error: "title is required" }, { status: 400 });
  }

  const { sessions } = getRuntime();
  const updated = sessions.renameConversation(id, "web", externalUserId, title);
  if (!updated) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }

  return json({
    ok: true,
    session: {
      id: updated.id,
      title: updated.title,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt
    }
  });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  if (!id) {
    return json({ ok: false, error: "Session ID is required" }, { status: 400 });
  }

  let body: { userId?: string; profileId?: string };
  try {
    body = (await request.json()) as { userId?: string; profileId?: string };
  } catch {
    body = {};
  }

  const userId = sanitizeWebUserId(body.userId);
  const profileId = sanitizeWebProfileId(body.profileId);
  const externalUserId = toWebExternalUserId(userId, profileId);
  const { pool } = getWebRuntimeContext(profileId);
  const runner = pool.get(externalUserId, id);
  if (runner.isRunning()) {
    return json({ ok: false, error: "Cannot delete a session while it is running" }, { status: 409 });
  }

  const deleted = getRuntime().sessions.deleteConversation(id, "web", externalUserId);
  if (!deleted) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }
  pool.reset(externalUserId, id);
  return json({ ok: true, deleted: true });
};
