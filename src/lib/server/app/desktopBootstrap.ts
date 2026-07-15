import type { DesktopProfileSummary } from "$lib/shared/desktop";

export function resolveDesktopProfiles(settings: unknown): DesktopProfileSummary[] {
  const root = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const channels = root.channels && typeof root.channels === "object"
    ? root.channels as Record<string, unknown>
    : {};
  const web = channels.web && typeof channels.web === "object"
    ? channels.web as Record<string, unknown>
    : {};
  const hasConfiguredInstances = Array.isArray(web.instances);
  const instances = hasConfiguredInstances ? web.instances as unknown[] : [];
  const agents = Array.isArray(root.agents) ? root.agents as unknown[] : [];
  const agentNameById = new Map(agents.flatMap((item): Array<[string, string]> => {
    if (!item || typeof item !== "object") return [];
    const agent = item as Record<string, unknown>;
    const id = String(agent.id ?? "").trim();
    if (!id) return [];
    return [[id, String(agent.name ?? "").trim() || id]];
  }));

  const profiles = instances.flatMap((item): DesktopProfileSummary[] => {
    if (!item || typeof item !== "object") return [];
    const profile = item as Record<string, unknown>;
    const id = String(profile.id ?? "").trim();
    if (!id || profile.enabled === false) return [];
    const name = String(profile.name ?? "").trim() || id;
    const agentId = String(profile.agentId ?? "").trim();
    return [{
      id,
      name,
      ...(agentId ? { agentId, agentName: agentNameById.get(agentId) ?? agentId } : {})
    }];
  });

  if (profiles.length > 0 || hasConfiguredInstances) return profiles;
  return [{ id: "default", name: "Default Web" }];
}
