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

export interface WebRuntimeContext {
  store: MomRuntimeStore;
  pool: RunnerPool;
}

const webRuntimes = new Map<string, WebRuntimeContext>();
const projectRuntimes = new Map<string, WebRuntimeContext>();

// Mirrors the project directory sanitizer in sessions/store.ts so the runtime
// workspace sits alongside the project's session store under the same slug.
function sanitizeProjectDirPart(value: string): string {
  const safe = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "project";
}

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
  const key = sanitizeProjectDirPart(projectId);
  const existing = projectRuntimes.get(key);
  if (existing) return existing;

  const workspaceDir = path.join(storagePaths.projectsDir, key, "runtime");
  const created = buildRuntimeContext(workspaceDir);
  projectRuntimes.set(key, created);
  return created;
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
  const profileId = sanitizeWebProfileId(input.profileId);
  const userId = sanitizeWebUserId(input.userId);
  const conversationId = String(input.conversationId ?? "").trim();
  if (!conversationId) return { ok: true, stopped: false };

  const { pool } = getRuntimeContextForConversation(profileId, conversationId);
  const externalUserId = toWebExternalUserId(userId, profileId);
  const runner = pool.get(externalUserId, conversationId);
  if (!runner.isRunning()) return { ok: true, stopped: false };
  runner.abort();
  return { ok: true, stopped: true };
}
