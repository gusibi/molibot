import path from "node:path";
import { getRuntime } from "$lib/server/app/runtime";
import { RunnerPool } from "$lib/server/agent/runner";
import { MomRuntimeStore } from "$lib/server/agent/store";
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

export function getWebRuntimeContext(profileId: string): WebRuntimeContext {
  const key = sanitizeWebProfileId(profileId);
  const existing = webRuntimes.get(key);
  if (existing) return existing;

  const runtime = getRuntime();
  const workspaceDir = path.join(storagePaths.webWorkspaceDir, "bots", key);
  const store = new MomRuntimeStore(workspaceDir);
  const pool = new RunnerPool(
    "web",
    store,
    runtime.getSettings,
    runtime.updateSettings,
    runtime.usageTracker,
    runtime.memory
  );
  const created = { store, pool };
  webRuntimes.set(key, created);
  return created;
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

  const { pool } = getWebRuntimeContext(profileId);
  const externalUserId = toWebExternalUserId(userId, profileId);
  const runner = pool.get(externalUserId, conversationId);
  if (!runner.isRunning()) return { ok: true, stopped: false };
  runner.abort();
  return { ok: true, stopped: true };
}
