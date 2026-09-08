import { resolve } from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { config } from "$lib/server/app/env.js";
import { readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts.js";
import { sanitizeWebProfileId, sanitizeWebUserId, toWebExternalUserId } from "$lib/server/web/identity";

const PREVIEW_LIMIT = 100;

function requesterOf(url: URL): string | undefined {
  if (!url.searchParams.has("userId") && !url.searchParams.has("profileId")) return undefined;
  return toWebExternalUserId(
    sanitizeWebUserId(url.searchParams.get("userId")),
    sanitizeWebProfileId(url.searchParams.get("profileId"))
  );
}

/**
 * T7 adjacent transcript preview: authorized on-demand read for one session.
 * Pure read — never resumes archived sessions and never fabricates activity.
 * Unknown, unauthorized or purged sources return explicit
 * `source-unavailable` (T4 evidence contract) instead of crashing.
 */
export const GET: RequestHandler = async ({ url }) => {
  const conversationId = String(url.searchParams.get("conversationId") ?? "").trim();
  if (!conversationId) return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  const requester = requesterOf(url);
  try {
    const { sessions, sessionLifecycle } = getRuntime();
    const owner = sessions.getWebConversationOwner(conversationId);
    if (owner) {
      if (requester !== undefined && owner !== requester) {
        return json({ ok: false, error: "source-unavailable", conversationId }, { status: 404 });
      }
      const conversation = sessions.getConversationById(conversationId, "web", owner);
      if (!conversation) return json({ ok: false, error: "source-unavailable", conversationId }, { status: 404 });
      const messages = sessions.listMessages(conversationId, PREVIEW_LIMIT).map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }));
      return json({
        ok: true,
        preview: {
          conversationId,
          title: conversation.title,
          state: sessionLifecycle.peekLifecycleState(conversationId, requester) ?? "active",
          messages
        }
      });
    }
    const projectId = sessions.getConversationProjectId(conversationId);
    if (projectId) {
      const conversation = sessions.getProjectConversation(projectId, conversationId);
      if (!conversation) return json({ ok: false, error: "source-unavailable", conversationId }, { status: 404 });
      const messages = sessions.listMessages(conversationId, PREVIEW_LIMIT).map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }));
      return json({
        ok: true,
        preview: {
          conversationId,
          title: conversation.title,
          projectId,
          state: sessionLifecycle.peekLifecycleState(conversationId, requester) ?? "active",
          messages
        }
      });
    }
    // External-channel sessions are a read-only projection of the Agent
    // `contexts/` store: serve the transcript read-only, or an honest
    // source-unavailable with the reason when it is gone.
    const external = readExternalTranscriptFromContexts(resolve(config.dataDir), conversationId);
    if (external) {
      const messages = external.messages.slice(-PREVIEW_LIMIT).map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }));
      return json({
        ok: true,
        preview: {
          conversationId,
          title: external.conversation.title,
          state: sessionLifecycle.peekLifecycleState(conversationId, requester) ?? "active",
          readOnly: true,
          messages
        }
      });
    }
    return json({ ok: false, error: "source-unavailable", reason: "external transcript is missing or expired", conversationId }, { status: 404 });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
