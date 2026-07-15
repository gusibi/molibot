import { statSync } from "node:fs";
import { isValidTimeZone } from "$lib/server/time";
import type { McpServerConfig, RuntimeSettings } from "./schema.js";

export function validateAgentReferences(current: RuntimeSettings, patch: Partial<RuntimeSettings>): string | null {
  const nextAgents = Array.isArray(patch.agents) ? patch.agents : current.agents;
  const nextChannels = patch.channels ?? current.channels;
  const nextAgentIds = new Set(nextAgents.map((agent) => agent.id));

  for (const [channelKey, channel] of Object.entries(nextChannels ?? {})) {
    const instances = channel?.instances ?? [];
    for (const instance of instances) {
      const agentId = String(instance.agentId ?? "").trim();
      if (!agentId) continue;
      if (!nextAgentIds.has(agentId)) {
        return `Channel instance '${channelKey}/${instance.id}' references missing agent '${agentId}'.`;
      }
    }
  }

  return null;
}

export function validateSkillDraftSettings(current: RuntimeSettings, patch: Partial<RuntimeSettings>): string | null {
  if (!("skillDrafts" in patch)) return null;
  const next = patch.skillDrafts ?? current.skillDrafts;
  const enabled = Boolean(next?.autoSave?.enabled);
  const skillPath = String(next?.template?.skillPath ?? "").trim();
  if (!enabled) return null;
  if (!skillPath) {
    return "Skill draft auto-save requires a draft skeleton SKILL.md path before it can be enabled.";
  }
  try {
    const stat = statSync(skillPath);
    if (!stat.isFile()) {
      return `Configured skill draft skeleton must be a SKILL.md file: ${skillPath}`;
    }
  } catch {
    return `Configured skill draft skeleton not found: ${skillPath}`;
  }
  return null;
}

export function validatePluginSettings(current: RuntimeSettings, patch: Partial<RuntimeSettings>): string | null {
  if (!("plugins" in patch)) return null;
  const next = patch.plugins ?? current.plugins;
  const nextCloudflareHtml = next.cloudflareHtml ?? {};
  const currentCloudflareHtml = current.plugins.cloudflareHtml;
  const cloudflareHtml = {
    ...currentCloudflareHtml,
    ...nextCloudflareHtml
  };
  if (!cloudflareHtml.enabled) return null;
  const accessMode = String(cloudflareHtml.accessMode ?? "worker").trim() === "direct"
    ? "direct"
    : "worker";
  const workerBaseHost = String(
    cloudflareHtml.workerBaseHost ??
    ("publicBaseUrl" in nextCloudflareHtml ? (nextCloudflareHtml as { publicBaseUrl?: string }).publicBaseUrl : "") ??
    ""
  ).trim();
  const publicBaseHost = String(cloudflareHtml.publicBaseHost ?? "").trim();
  if (accessMode === "worker" && !workerBaseHost) {
    return "Cloudflare HTML publish plugin requires a Worker base host.";
  }
  if (accessMode === "direct" && !publicBaseHost) {
    return "Cloudflare HTML publish plugin requires a public R2 base host when direct mode is selected.";
  }
  if (!cloudflareHtml.bucketName.trim()) {
    return "Cloudflare HTML publish plugin requires a bucket name.";
  }
  if (!cloudflareHtml.accountId.trim()) {
    return "Cloudflare HTML publish plugin requires an account ID.";
  }
  if (!cloudflareHtml.accessKeyId.trim() || !cloudflareHtml.secretAccessKey.trim()) {
    return "Cloudflare HTML publish plugin requires both accessKeyId and secretAccessKey.";
  }
  return null;
}

export function validateTimezonePatch(current: RuntimeSettings, patch: Partial<RuntimeSettings>): string | null {
  if (!("timezone" in patch)) return null;
  const timezone = String(patch.timezone ?? current.timezone ?? "").trim();
  if (!timezone) return "Timezone cannot be empty.";
  if (!isValidTimeZone(timezone)) {
    return `Invalid timezone: ${timezone}. Use an IANA timezone such as Asia/Shanghai.`;
  }
  return null;
}

export function validateServerPortPatch(patch: Partial<RuntimeSettings>): string | null {
  if (!("serverPort" in patch)) return null;
  const port = Number(patch.serverPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return "Server port must be an integer between 1024 and 65535.";
  }
  return null;
}

export type { McpServerConfig };
