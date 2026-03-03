import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import type {
  RuntimeSettings,
  CustomProviderConfig,
  TelegramBotConfig,
  FeishuBotConfig,
  AgentSettings
} from "$lib/server/settings";

type SettingsBody = Partial<RuntimeSettings> & {
  telegramAllowedChatIds?: string[] | string;
  customProviders?: CustomProviderConfig[] | string;
  telegramBots?: TelegramBotConfig[] | string;
  feishuBots?: FeishuBotConfig[] | string;
  agents?: AgentSettings[] | string;
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

  if (typeof body.agents === "string") {
    try {
      patch.agents = JSON.parse(body.agents) as AgentSettings[];
    } catch {
      patch.agents = [];
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

  const updated = runtime.updateSettings(patch);
  return json({ ok: true, settings: updated });
};
