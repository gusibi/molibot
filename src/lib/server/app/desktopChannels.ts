import type { ChannelInstanceSettings, RuntimeSettings } from "$lib/server/settings/schema";
import type {
  DesktopChannelGroup,
  DesktopChannelInstance,
  DesktopChannelSaveRequest,
  DesktopExternalChannel,
  DesktopChannelsSummary
} from "$lib/shared/desktop";

// Web is surfaced by the dedicated Web Profiles section, so it is excluded here.
// Known external channels are listed first; any other non-web channel follows
// in insertion order.
const KNOWN_CHANNEL_ORDER = ["telegram", "feishu", "qq", "weixin"] as const;
const CHANNEL_FIELDS: Record<DesktopExternalChannel, { visible: string[]; secret: string[] }> = {
  telegram: { visible: ["streamOutput"], secret: ["token"] },
  feishu: { visible: ["appId", "streamOutput"], secret: ["appSecret", "verificationToken", "encryptKey"] },
  qq: { visible: ["appId"], secret: ["clientSecret"] },
  weixin: { visible: ["baseUrl"], secret: [] }
};

function isDesktopChannel(channel: string): channel is DesktopExternalChannel {
  return channel in CHANNEL_FIELDS;
}

/**
 * Maps a channel instance into a credential-safe Desktop view. The instance
 * `credentials` (bot tokens / app secrets) are dropped entirely, and
 * `allowedChatIds` is reduced to a count — the overview only needs identity,
 * enabled state, the linked agent, and the allow-list size.
 */
export function buildDesktopChannelInstance(
  instance: ChannelInstanceSettings,
  channel: string = "telegram"
): DesktopChannelInstance {
  const policy = isDesktopChannel(channel) ? CHANNEL_FIELDS[channel] : { visible: [], secret: [] };
  const credentials = instance.credentials ?? {};
  return {
    id: instance.id,
    name: instance.name || instance.id,
    enabled: instance.enabled !== false,
    agentId: instance.agentId ?? "",
    allowedChatCount: Array.isArray(instance.allowedChatIds) ? instance.allowedChatIds.length : 0,
    allowedChatIds: Array.isArray(instance.allowedChatIds) ? instance.allowedChatIds.map(String) : [],
    sandboxEnabled: instance.sandboxEnabled === undefined ? null : Boolean(instance.sandboxEnabled),
    fields: Object.fromEntries(policy.visible.map((key) => [key, String(credentials[key] ?? "")])) ,
    configuredSecrets: policy.secret.filter((key) => String(credentials[key] ?? "").trim().length > 0)
  };
}

export function buildDesktopChannelsSummary(settings: RuntimeSettings): DesktopChannelsSummary {
  const channels = settings.channels ?? {};
  const keys = Object.keys(channels).filter((key) => key !== "web");
  keys.sort((a, b) => {
    const ai = KNOWN_CHANNEL_ORDER.indexOf(a as (typeof KNOWN_CHANNEL_ORDER)[number]);
    const bi = KNOWN_CHANNEL_ORDER.indexOf(b as (typeof KNOWN_CHANNEL_ORDER)[number]);
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  });

  let totalInstances = 0;
  let enabledInstances = 0;
  const groups: DesktopChannelGroup[] = keys.map((channel) => {
    const rawInstances = Array.isArray(channels[channel]?.instances) ? channels[channel].instances : [];
    const instances = rawInstances.map((instance) => buildDesktopChannelInstance(instance, channel));
    const enabled = instances.filter((instance) => instance.enabled).length;
    totalInstances += instances.length;
    enabledInstances += enabled;
    return { channel, total: instances.length, enabled, instances };
  });

  return { groups, counts: { totalInstances, enabledInstances } };
}

export function saveDesktopChannelInstance(settings: RuntimeSettings, request: DesktopChannelSaveRequest): ChannelInstanceSettings[] {
  const channel = String(request.channel ?? "").trim();
  if (!isDesktopChannel(channel)) throw new Error("Unsupported channel");
  const id = String(request.id ?? "").trim();
  const previousId = String(request.previousId ?? "").trim();
  const agentId = String(request.agentId ?? "").trim();
  if (!id) throw new Error("instance id is required");
  if (agentId && !settings.agents.some((agent) => agent.id === agentId)) throw new Error(`Agent not found: ${agentId}`);
  const instances = Array.isArray(settings.channels?.[channel]?.instances) ? settings.channels[channel].instances : [];
  const current = instances.find((instance) => instance.id === (previousId || id));
  const credentials = { ...(current?.credentials ?? {}) };
  const policy = CHANNEL_FIELDS[channel];
  for (const key of policy.visible) credentials[key] = String(request.fields?.[key] ?? "").trim();
  for (const key of policy.secret) {
    if (request.clearSecrets?.includes(key)) delete credentials[key];
    const replacement = String(request.secretValues?.[key] ?? "").trim();
    if (replacement) credentials[key] = replacement;
  }
  const next: ChannelInstanceSettings = {
    ...(current ?? {}),
    id,
    name: String(request.name ?? "").trim() || id,
    enabled: request.enabled !== false,
    agentId,
    sandboxEnabled: request.sandboxEnabled === null ? undefined : Boolean(request.sandboxEnabled),
    credentials,
    allowedChatIds: Array.from(new Set((request.allowedChatIds ?? []).map((value) => String(value).trim()).filter(Boolean)))
  };
  return [...instances.filter((instance) => instance.id !== id && instance.id !== previousId), next];
}

export function deleteDesktopChannelInstance(settings: RuntimeSettings, channelInput: string, instanceId: string): ChannelInstanceSettings[] {
  const channel = String(channelInput ?? "").trim();
  const id = String(instanceId ?? "").trim();
  if (!isDesktopChannel(channel)) throw new Error("Unsupported channel");
  const instances = Array.isArray(settings.channels?.[channel]?.instances) ? settings.channels[channel].instances : [];
  if (!instances.some((instance) => instance.id === id)) throw new Error("Channel instance not found");
  return instances.filter((instance) => instance.id !== id);
}
