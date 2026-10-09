import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { config } from "$lib/server/app/env.js";
import { claimExternalSessionAgent } from "$lib/server/app/externalSessionsFromContexts.js";
import { requireEnabledAgent } from "$lib/server/sessions/sessionAgentService.js";
import { claimAgentConversation } from "$lib/server/sessions/sessionAgentService.js";
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const runtime = getRuntime();
    const conversationId = String(body.conversationId ?? "");
    const owner = runtime.sessions.getWebConversationOwner(conversationId);
    if (!owner) {
      const agentId = requireEnabledAgent(runtime.getSettings(), String(body.agentId ?? "")).id;
      return json({ ok: true, conversation: claimExternalSessionAgent(config.dataDir, conversationId, agentId), readOnly: true });
    }
    const conversation = claimAgentConversation(runtime.sessions, runtime.getSettings(), { externalUserId: owner, conversationId, agentId: String(body.agentId ?? "") });
    return json({ ok: true, conversation });
  } catch (cause) { return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 409 }); }
};
