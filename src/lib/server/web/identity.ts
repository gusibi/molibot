export function sanitizeWebProfileId(input: string | undefined | null): string {
  const raw = String(input ?? "").trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "");
  return safe || "default";
}

export function sanitizeWebUserId(input: string | undefined | null): string {
  const raw = String(input ?? "").trim();
  return raw || "web-anonymous";
}

export function toWebExternalUserId(userId: string, profileId: string): string {
  return `web:${sanitizeWebProfileId(profileId)}:${sanitizeWebUserId(userId)}`;
}
