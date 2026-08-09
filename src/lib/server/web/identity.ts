export function sanitizeWebProfileId(input: string | undefined | null): string {
  const raw = String(input ?? "").trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "");
  return safe || "default";
}

/**
 * Durable attempts run through a concrete Web channel manager. The Web API
 * also accepts virtual profile ids, so resolve those ids before persisting the
 * execution instead of letting a queued attempt fail at manager lookup time.
 */
export function resolveWebDurableBotId<T>(
  profileId: string,
  channelManagers: ReadonlyMap<string, ReadonlyMap<string, T>>
): string {
  const requested = sanitizeWebProfileId(profileId);
  const webManagers = channelManagers.get("web");
  if (webManagers?.has(requested)) return requested;
  if (webManagers?.has("default")) return "default";

  const firstManagerId = webManagers?.keys().next().value;
  return typeof firstManagerId === "string" && firstManagerId ? firstManagerId : requested;
}

export function sanitizeWebUserId(input: string | undefined | null): string {
  const raw = String(input ?? "").trim();
  return raw || "web-anonymous";
}

export function toWebExternalUserId(userId: string, profileId: string): string {
  return `web:${sanitizeWebProfileId(profileId)}:${sanitizeWebUserId(userId)}`;
}
