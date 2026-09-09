import type { ConversationMessage } from "$lib/shared/types/message";
import { getRuntime } from "$lib/server/app/runtime";
import { getProjectRuntimeContext, getWebRuntimeContext, resolveWebConversationIdentity } from "$lib/server/web/runtimeContext";

/**
 * Authorized lookup of a Session's workspace directory.
 *
 * Shared by the attachment byte route (`/api/web/files`) and the Artifact
 * Panel's static preview route: both must agree on which workspace a Session
 * owns and on refusing a Session the caller cannot reach, and a second copy of
 * this rule is how the two would silently diverge (pitfall #7).
 *
 * Returns `null` for an unknown or unauthorized Session; callers turn that into
 * a generic not-found so the response never reveals whether the Session exists.
 */
export interface AuthorizedConversation {
  externalUserId: string;
  conversation: { id: string; externalUserId: string };
  messages: ConversationMessage[];
  workspaceDir: string;
}

export function resolveAuthorizedConversation(input: {
  profileId: string;
  userId: string;
  sessionId: string;
  projectId?: string;
}): AuthorizedConversation | null {
  const runtime = getRuntime();
  const projectId = input.projectId || runtime.sessions.getConversationProjectId(input.sessionId) || undefined;
  if (projectId) {
    const conversation = runtime.sessions.getProjectConversation(projectId, input.sessionId);
    if (!conversation) return null;
    return {
      externalUserId: conversation.externalUserId,
      conversation,
      messages: runtime.sessions.listMessages(conversation.id),
      workspaceDir: getProjectRuntimeContext(projectId).store.getWorkspaceDir()
    };
  }
  // The Desktop sidebar (plan §12) aggregates every Web owner's conversations,
  // so resolve the real owner from the index like the sessions read API does;
  // trusting the caller's derived identity alone 404s browser-created sessions
  // whose owner carries a real user id.
  const identity = resolveWebConversationIdentity({
    profileId: input.profileId,
    userId: input.userId,
    conversationId: input.sessionId
  });
  const conversation = runtime.sessions.getConversationById(input.sessionId, "web", identity.externalUserId);
  if (!conversation) return null;
  return {
    externalUserId: identity.externalUserId,
    conversation,
    messages: runtime.sessions.listMessages(conversation.id),
    workspaceDir: getWebRuntimeContext(identity.profileId).store.getWorkspaceDir()
  };
}
