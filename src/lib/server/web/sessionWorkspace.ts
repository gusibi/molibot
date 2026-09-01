import type { ConversationMessage } from "$lib/shared/types/message";
import { getRuntime } from "$lib/server/app/runtime";
import { toWebExternalUserId } from "$lib/server/web/identity";
import { getProjectRuntimeContext, getWebRuntimeContext } from "$lib/server/web/runtimeContext";

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
  const externalUserId = toWebExternalUserId(input.userId, input.profileId);
  const conversation = runtime.sessions.getConversationById(input.sessionId, "web", externalUserId);
  if (!conversation) return null;
  return {
    externalUserId,
    conversation,
    messages: runtime.sessions.listMessages(conversation.id),
    workspaceDir: getWebRuntimeContext(input.profileId).store.getWorkspaceDir()
  };
}
