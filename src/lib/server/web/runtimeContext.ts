import path from "node:path";
import { getRuntime } from "$lib/server/app/runtime";
import { RunnerPool } from "$lib/server/agent/core/runnerPool";
import { MomRuntimeStore } from "$lib/server/agent/session/store";
import { storagePaths } from "$lib/server/infra/db/storage";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";
import {
  getOrCreateProjectRuntimeHandle,
  projectRuntimeWorkspaceDir
} from "$lib/server/projects/runtimeCache";

export interface WebRuntimeContext {
  store: MomRuntimeStore;
  pool: RunnerPool;
}

const webRuntimes = new Map<string, WebRuntimeContext>();

function buildRuntimeContext(workspaceDir: string): WebRuntimeContext {
  const runtime = getRuntime();
  const store = new MomRuntimeStore(workspaceDir);
  const pool = new RunnerPool(
    "web",
    store,
    runtime.getSettings,
    runtime.updateSettings,
    runtime.usageTracker,
    runtime.modelErrorTracker,
    runtime.memory,
    runtime.hookManager
  );
  return { store, pool };
}

export function getWebRuntimeContext(profileId: string): WebRuntimeContext {
  const key = sanitizeWebProfileId(profileId);
  const existing = webRuntimes.get(key);
  if (existing) return existing;

  const workspaceDir = path.join(storagePaths.webWorkspaceDir, "bots", key);
  const created = buildRuntimeContext(workspaceDir);
  webRuntimes.set(key, created);
  return created;
}

/**
 * Runtime for a project conversation. Its agent execution — the context
 * transcript persisted by the runner — lives under the project workspace
 * (`<dataRoot>/projects/<projectId>/runtime`) so nothing leaks into the shared
 * bot workspace under the channel `moli-*` bots directory.
 */
export function getProjectRuntimeContext(projectId: string): WebRuntimeContext {
  return getOrCreateProjectRuntimeHandle(projectId, () =>
    buildRuntimeContext(projectRuntimeWorkspaceDir(projectId))
  );
}

/**
 * Picks the project runtime when a projectId is supplied, otherwise the shared
 * bot runtime for the Web profile. Use this at call sites that already know the
 * project (e.g. an inbound send that resolved the project context).
 */
export function resolveRuntimeContext(input: {
  profileId: string;
  projectId?: string | null;
}): WebRuntimeContext {
  const projectId = String(input.projectId ?? "").trim();
  if (projectId) return getProjectRuntimeContext(projectId);
  return getWebRuntimeContext(input.profileId);
}

/**
 * Same as resolveRuntimeContext but derives the project association from an
 * existing conversation id. Use this at call sites that only have a
 * conversation id (stop, compact, host-bash approval resume).
 */
export function getRuntimeContextForConversation(
  profileId: string,
  conversationId?: string | null
): WebRuntimeContext {
  const id = String(conversationId ?? "").trim();
  const projectId = id ? getRuntime().sessions.getConversationProjectId(id) : null;
  return resolveRuntimeContext({ profileId, projectId });
}

export function stopWebRunner(input: {
  profileId: string;
  conversationId: string;
  userId?: string;
}): { ok: true; stopped: boolean } {
  const conversationId = String(input.conversationId ?? "").trim();
  if (!conversationId) return { ok: true, stopped: false };

  const identity = resolveWebConversationIdentity({
    profileId: input.profileId,
    userId: input.userId,
    conversationId
  });
  const { pool } = getRuntimeContextForConversation(identity.profileId, conversationId);
  const runner = pool.get(resolveRunnerChatId(conversationId, identity.externalUserId), conversationId);
  if (!runner.isRunning()) return { ok: true, stopped: false };
  runner.abort();
  return { ok: true, stopped: true };
}

/**
 * Inject a message into the turn that is already running for this conversation.
 * This is the Web/Desktop transport for the shared Runner capability the chat
 * channels already expose as `/steer`: the text joins the live agent loop
 * instead of waiting for the current turn to end. Returns `delivered: false`
 * when nothing is running, so the caller can fall back to its normal queue.
 */
export function steerWebRunner(input: {
  profileId: string;
  conversationId: string;
  userId?: string;
  text: string;
  mode?: "steer" | "follow_up";
}): { ok: true; delivered: boolean } {
  const conversationId = String(input.conversationId ?? "").trim();
  const text = String(input.text ?? "").trim();
  if (!conversationId || !text) return { ok: true, delivered: false };

  const identity = resolveWebConversationIdentity({
    profileId: input.profileId,
    userId: input.userId,
    conversationId
  });
  const { pool } = getRuntimeContextForConversation(identity.profileId, conversationId);
  const chatId = resolveRunnerChatId(conversationId, identity.externalUserId);
  const delivered = input.mode === "follow_up"
    ? pool.followUp(chatId, conversationId, text)
    : pool.steer(chatId, conversationId, text);
  return { ok: true, delivered };
}

/** Wait until the aborted runner has finalized its persisted partial answer. */
export async function waitForWebRunnerIdle(input: {
  profileId: string;
  conversationId: string;
  userId?: string;
  timeoutMs?: number;
}): Promise<void> {
  const identity = resolveWebConversationIdentity({
    profileId: input.profileId,
    userId: input.userId,
    conversationId: input.conversationId
  });
  const { pool } = getRuntimeContextForConversation(identity.profileId, input.conversationId);
  const runner = pool.get(
    resolveRunnerChatId(input.conversationId, identity.externalUserId),
    input.conversationId
  );
  const deadline = Date.now() + Math.max(0, input.timeoutMs ?? 2_000);
  while (runner.isRunning() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // Let the awaiting stream route project the finalized Runner result into the
  // UI transcript before the Stop request tells Desktop to reload it.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runner pool key for a conversation. Project conversations are keyed by the
 * conversation's own externalUserId (it may have originated on a channel bot,
 * e.g. Feishu Project mode); plain Web conversations are keyed by the OWNER
 * recorded in the Web index — the Desktop sidebar aggregates every owner's
 * conversations (plan §12), so a caller whose derived identity is
 * `web:<profile>:web-anonymous` opening a browser-created session must key the
 * runner by the owner or the turn forks a fresh agent context instead of
 * reopening this session's history.
 */
export function resolveRunnerChatId(conversationId: string | undefined, fallbackExternalUserId: string): string {
  const id = String(conversationId ?? "").trim();
  if (!id) return fallbackExternalUserId;
  const sessions = getRuntime().sessions;
  const projectId = sessions.getConversationProjectId(id);
  if (!projectId) return sessions.getWebConversationOwner(id) ?? fallbackExternalUserId;
  const conversation = sessions.getProjectConversation(projectId, id);
  return conversation?.externalUserId || fallbackExternalUserId;
}

/**
 * The identity a Web request should act on for a given conversation. When the
 * conversation id is known and the Web index records its owner, that owner (and
 * the profile embedded in it) wins — reads, sends, stops and steers all reuse
 * the exact identity the conversation was created under. Only conversations
 * the index does not know (brand-new drafts) fall back to the caller's derived
 * `web:<profileId>:<userId>` identity.
 */
export function resolveWebConversationIdentity(input: {
  profileId: string;
  userId?: string;
  conversationId?: string | null;
}): { profileId: string; userId: string; externalUserId: string } {
  const profileId = sanitizeWebProfileId(input.profileId);
  const userId = sanitizeWebUserId(input.userId);
  const id = String(input.conversationId ?? "").trim();
  const owner = id ? getRuntime().sessions.getWebConversationOwner(id) : null;
  if (!owner) return { profileId, userId, externalUserId: toWebExternalUserId(userId, profileId) };
  const match = owner.match(/^web:([^:]+):(.*)$/);
  return {
    profileId: match?.[1] || profileId,
    userId: match?.[2] || userId,
    externalUserId: owner
  };
}
