import type { RuntimeSettings, ChannelInstanceSettings } from "$lib/server/settings";
import type {
  DesktopWebProfile,
  DesktopWebProfilePatch,
  DesktopWebProfileSaveRequest
} from "$lib/shared/desktop";

/**
 * Returns every configured Web Profile (including disabled ones) with only
 * credential-safe fields — id, name, enabled, linked agent id/name, and the
 * sandbox override. Credentials and allowed-chat lists never reach the WebView.
 */
export function resolveDesktopWebProfiles(settings: RuntimeSettings): DesktopWebProfile[] {
  const web = settings.channels?.web;
  const instances: ChannelInstanceSettings[] = Array.isArray(web?.instances) ? web.instances : [];
  const agents = Array.isArray(settings.agents) ? settings.agents : [];

  return instances.map((instance) => summarizeDesktopWebProfile(instance, agents));
}

export function saveDesktopWebProfile(
  settings: RuntimeSettings,
  request: DesktopWebProfileSaveRequest
): ChannelInstanceSettings[] {
  const id = String(request.id ?? "").trim();
  const previousId = String(request.previousId ?? "").trim();
  const agentId = String(request.agentId ?? "").trim();
  if (!id) throw new Error("profileId is required");
  if (agentId && !settings.agents.some((agent) => agent.id === agentId)) throw new Error(`Agent not found: ${agentId}`);
  const instances = Array.isArray(settings.channels?.web?.instances) ? settings.channels.web.instances : [];
  const current = instances.find((instance) => instance.id === (previousId || id));
  const next: ChannelInstanceSettings = {
    ...(current ?? { credentials: {}, allowedChatIds: [] }),
    id,
    name: String(request.name ?? "").trim() || id,
    enabled: request.enabled !== false,
    agentId,
    sandboxEnabled: request.sandboxEnabled === undefined ? undefined : Boolean(request.sandboxEnabled)
  };
  return [...instances.filter((instance) => instance.id !== id && instance.id !== previousId), next];
}

export function deleteDesktopWebProfile(settings: RuntimeSettings, profileId: string): ChannelInstanceSettings[] {
  const id = String(profileId ?? "").trim();
  if (!id) throw new Error("profileId is required");
  const instances = Array.isArray(settings.channels?.web?.instances) ? settings.channels.web.instances : [];
  if (!instances.some((instance) => instance.id === id)) throw new Error(`Web profile not found: ${id}`);
  return instances.filter((instance) => instance.id !== id);
}

/**
 * Builds a new `channels.web.instances` array with only the `name`, `enabled`,
 * and/or linked `agentId` fields of the matching profile patched. All other
 * fields (credentials, allowedChatIds, sandboxEnabled, display) are
 * preserved verbatim so a credential-safe Desktop toggle never erases the
 * server-owned configuration it does not see.
 */
export function patchDesktopWebProfile(
  settings: RuntimeSettings,
  profileId: string,
  patch: DesktopWebProfilePatch
): ChannelInstanceSettings[] {
  const targetId = String(profileId ?? "").trim();
  if (!targetId) throw new Error("profileId is required");

  const web = settings.channels?.web;
  const instances: ChannelInstanceSettings[] = Array.isArray(web?.instances) ? web.instances : [];
  const nextAgentId = patch.agentId?.trim();
  if (nextAgentId && !settings.agents.some((agent) => agent.id === nextAgentId)) {
    throw new Error(`Agent not found: ${nextAgentId}`);
  }
  let found = false;

  const next = instances.map((instance) => {
    if (instance.id !== targetId) return instance;
    found = true;
    const nextName = patch.name !== undefined ? patch.name.trim() : instance.name;
    const nextEnabled = patch.enabled !== undefined ? Boolean(patch.enabled) : instance.enabled;
    return {
      ...instance,
      name: nextName?.trim() || instance.id,
      enabled: nextEnabled,
      agentId: patch.agentId !== undefined ? nextAgentId ?? "" : instance.agentId
    };
  });

  if (!found) throw new Error(`Web profile not found: ${targetId}`);
  return next;
}

export function summarizeDesktopWebProfile(
  instance: ChannelInstanceSettings,
  agents: RuntimeSettings["agents"]
): DesktopWebProfile {
  const agent = agents.find((candidate) => candidate.id === instance.agentId);
  return {
    id: instance.id,
    name: instance.name?.trim() || instance.id,
    enabled: instance.enabled !== false,
    agentId: instance.agentId ?? "",
    agentName: agent?.name?.trim() || "",
    sandboxEnabled: instance.sandboxEnabled
  };
}
