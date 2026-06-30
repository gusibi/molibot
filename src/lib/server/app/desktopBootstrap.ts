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

  const profiles = instances.flatMap((item): DesktopProfileSummary[] => {
    if (!item || typeof item !== "object") return [];
    const profile = item as Record<string, unknown>;
    const id = String(profile.id ?? "").trim();
    if (!id || profile.enabled === false) return [];
    const name = String(profile.name ?? "").trim() || id;
    return [{ id, name }];
  });

  if (profiles.length > 0 || hasConfiguredInstances) return profiles;
  return [{ id: "default", name: "Default Web" }];
}
