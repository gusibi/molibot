import { agentWorkspaceDir, channelDataDir, listAgentSessions } from "$lib/server/sessions/agentStorage.js";
import path from "node:path";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { storagePaths } from "$lib/server/infra/db/storage";
import { DEFAULT_AGENT_ID } from "$lib/server/settings/schema";
import { botAgentId } from "$lib/server/sessions/executionIdentity.js";
import {
  buildSystemPromptPreview,
  getSystemPromptSources
} from "$lib/server/agent/prompts/prompt";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";

export const GET: RequestHandler = async ({ url }) => {
  const userId = sanitizeWebUserId(url.searchParams.get("userId"));
  const profileId = sanitizeWebProfileId(url.searchParams.get("profileId"));
  const sessionId = String(url.searchParams.get("sessionId") ?? "preview").trim() || "preview";
  const queryText = String(url.searchParams.get("query") ?? "").trim();

  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const externalUserId = toWebExternalUserId(userId, profileId);
  const existing = listAgentSessions(storagePaths.dataDir, { channel: "web", botId: profileId, chatId: externalUserId }).find(item => item.sessionId === sessionId);
  const agentId = existing?.agentId ?? botAgentId(settings, "web", profileId) ?? DEFAULT_AGENT_ID;
  const workspaceDir = agentWorkspaceDir(storagePaths.dataDir, agentId);
  const botProfileDir = channelDataDir(storagePaths.dataDir, "web", profileId);
  const memory =
    (await runtime.memory.buildPromptContext(
      { channel: "web", externalUserId },
      queryText,
      12
    )) || "(no working memory yet)";

  const prompt = buildSystemPromptPreview(
    workspaceDir,
    externalUserId,
    sessionId,
    memory,
    {
      agentId, botProfileDir,
      channel: "web",
      timezone: settings.timezone,
      settings
    }
  );
  const sources = getSystemPromptSources(workspaceDir, {
    agentId, botProfileDir,
    channel: "web",
    settings
  });

  return json({
    ok: true,
    prompt,
    sources,
    profileId,
    userId,
    externalUserId,
    sessionId
  });
};
