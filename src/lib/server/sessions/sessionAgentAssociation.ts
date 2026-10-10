import { existsSync } from "node:fs";
import { join } from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { readSessionMetadataFile, writeSessionOriginMetadata } from "$lib/server/agent/session/metadata.js";
import { isTaskSessionId } from "$lib/server/agent/session/ids.js";
import { associateContextSessionAgents } from "$lib/server/app/externalSessionsFromContexts.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import type { SessionStore } from "./store.js";
import { configuredSessionAgent } from "./sessionAgentService.js";

/** Persist historical ownership once so later Bot rebinding cannot change it. */
export function associateSessionAgents(sessions: SessionStore, settings: RuntimeSettings, dataRoot: string): { contexts: number; web: number; conflicts: number } {
  let web = 0;
  let conflicts = 0;
  for (const { conversation, externalUserId } of sessions.listAllWebConversationMeta()) {
    if (conversation.projectId || conversation.origin === "automation" || conversation.origin?.startsWith("internal:")) continue;
    const parts = externalUserId.split(":");
    if (parts[0] !== "web" || parts.length < 3) continue;
    const botId = parts[1];
    if ([botId, externalUserId, conversation.id].some(value => !/^[a-zA-Z0-9._@:+%\-]+$/.test(value) || value.includes(".."))) continue;
    const contextsDir = join(storagePaths.webWorkspaceDir, "bots", botId, externalUserId, "contexts");
    const metadata = readSessionMetadataFile(contextsDir, conversation.id);
    if (isTaskSessionId(conversation.id) || metadata?.origin === "automation" || metadata?.display?.eventPrompt) continue;
    const pinned = metadata?.agentId;
    if (conversation.agentId && pinned && conversation.agentId !== pinned) {
      conflicts += 1;
      continue;
    }
    const agentId = conversation.agentId ?? pinned ?? configuredSessionAgent(settings, "web", botId);
    if (!agentId) continue;
    if (!conversation.agentId && sessions.claimConversationAgent(conversation.id, externalUserId, agentId)) web += 1;
    if (!pinned && ["jsonl", "json"].some(extension => existsSync(join(contextsDir, `${conversation.id}.${extension}`)))) {
      writeSessionOriginMetadata(contextsDir, conversation.id, { agentId });
    }
  }
  const contexts = associateContextSessionAgents(dataRoot, settings);
  if (conflicts) console.warn(`[Session ownership] ${conflicts} Web Sessions have conflicting stored Agent identities; automatic association preserved both identities.`);
  return { contexts, web, conflicts };
}
