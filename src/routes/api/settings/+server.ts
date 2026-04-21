import { statSync } from "node:fs";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import type {
  RuntimeSettings,
  CustomProviderConfig,
  McpServerConfig,
  TelegramBotConfig,
  FeishuBotConfig,
  QQBotConfig,
  AgentSettings
} from "$lib/server/settings";

type SettingsBody = Partial<RuntimeSettings> & {
  telegramAllowedChatIds?: string[] | string;
  customProviders?: CustomProviderConfig[] | string;
  telegramBots?: TelegramBotConfig[] | string;
  feishuBots?: FeishuBotConfig[] | string;
  qqBots?: QQBotConfig[] | string;
  agents?: AgentSettings[] | string;
  mcpServers?: McpServerConfig[] | Record<string, unknown> | string;
  disabledSkillPaths?: string[] | string;
};

function normalizePatch(body: SettingsBody): Partial<RuntimeSettings> {
  const patch: Partial<RuntimeSettings> = { ...body };

  if (typeof body.telegramAllowedChatIds === "string") {
    patch.telegramAllowedChatIds = body.telegramAllowedChatIds
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  if (typeof body.customProviders === "string") {
    try {
      patch.customProviders = JSON.parse(body.customProviders) as CustomProviderConfig[];
    } catch {
      patch.customProviders = [];
    }
  }

  if (typeof body.telegramBots === "string") {
    try {
      patch.telegramBots = JSON.parse(body.telegramBots) as TelegramBotConfig[];
    } catch {
      patch.telegramBots = [];
    }
  }

  if (typeof body.feishuBots === "string") {
    try {
      patch.feishuBots = JSON.parse(body.feishuBots) as FeishuBotConfig[];
    } catch {
      patch.feishuBots = [];
    }
  }

  if (typeof body.qqBots === "string") {
    try {
      patch.qqBots = JSON.parse(body.qqBots) as QQBotConfig[];
    } catch {
      patch.qqBots = [];
    }
  }

  if (typeof body.agents === "string") {
    try {
      patch.agents = JSON.parse(body.agents) as AgentSettings[];
    } catch {
      patch.agents = [];
    }
  }

  if (typeof body.mcpServers === "string") {
    try {
      (patch as unknown as { mcpServers?: unknown }).mcpServers = JSON.parse(body.mcpServers) as unknown;
    } catch {
      patch.mcpServers = [];
    }
  } else if (body.mcpServers && typeof body.mcpServers === "object") {
    (patch as unknown as { mcpServers?: unknown }).mcpServers = body.mcpServers as unknown;
  }

  if (typeof body.disabledSkillPaths === "string") {
    try {
      patch.disabledSkillPaths = JSON.parse(body.disabledSkillPaths) as string[];
    } catch {
      patch.disabledSkillPaths = body.disabledSkillPaths
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
    }
  }

  return patch;
}

function validateAgentReferences(current: RuntimeSettings, patch: Partial<RuntimeSettings>): string | null {
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

function validateSkillDraftSettings(current: RuntimeSettings, patch: Partial<RuntimeSettings>): string | null {
  if (!("skillDrafts" in patch)) return null;
  const next = patch.skillDrafts ?? current.skillDrafts;
  const enabled = Boolean(next?.autoSave?.enabled);
  const skillPath = String(next?.template?.skillPath ?? "").trim();
  if (!enabled) return null;
  if (!skillPath) {
    return "Skill draft auto-save requires a workflow SKILL.md path before it can be enabled.";
  }
  try {
    const stat = statSync(skillPath);
    if (!stat.isFile()) {
      return `Configured skill draft workflow must be a SKILL.md file: ${skillPath}`;
    }
  } catch {
    return `Configured skill draft workflow not found: ${skillPath}`;
  }
  return null;
}

function validatePluginSettings(current: RuntimeSettings, patch: Partial<RuntimeSettings>): string | null {
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

export const GET: RequestHandler = async () => {
  const { getSettings } = getRuntime();
  return json({ ok: true, settings: getSettings() });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: SettingsBody;
  try {
    body = (await request.json()) as SettingsBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const patch = normalizePatch(body);
  const validationError = validateAgentReferences(runtime.getSettings(), patch);
  if (validationError) {
    return json({ ok: false, error: validationError }, { status: 400 });
  }
  const skillDraftValidationError = validateSkillDraftSettings(runtime.getSettings(), patch);
  if (skillDraftValidationError) {
    return json({ ok: false, error: skillDraftValidationError }, { status: 400 });
  }
  const pluginValidationError = validatePluginSettings(runtime.getSettings(), patch);
  if (pluginValidationError) {
    return json({ ok: false, error: pluginValidationError }, { status: 400 });
  }

  const updated = runtime.updateSettings(patch);
  return json({ ok: true, settings: updated });
};
