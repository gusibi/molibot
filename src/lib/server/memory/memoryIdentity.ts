/**
 * Canonical subject form. Qualifiers such as previous/current belong in the
 * value, not the identity: otherwise "user.car.previous" and
 * "user.car.current" both stay active and the model has to guess.
 */
export function normalizeMemorySubject(raw: string): string {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._\u4e00-\u9fa5-]+/g, "_")
    .replace(/[._]{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 120);
  const stripped = normalized.replace(
    /(?:[._-])(?:previous|former|old|past|current|now|latest|new|之前|以前|过去|现在|当前|最新|旧)$/i,
    ""
  );
  return stripped.replace(/[._-]+$/g, "") || normalized;
}

/**
 * One active record per subject is the read-side half of ADR 0008. Subject is
 * the identity; content is only the fallback for legacy rows that never had
 * one. Keeping this in a tiny module lets the prompt selector, profile builder
 * and injection merger agree without importing each other.
 */
export function memoryIdentityKey(row: { subject?: string; content: string }): string {
  const subject = String(row.subject ?? "").trim().toLowerCase();
  if (subject) return `subject:${subject}`;
  return `content:${String(row.content ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/**
 * Keep the newest record for each identity, preserving the input order of the
 * winners. Used before ranking so an older duplicate cannot win on class
 * weight alone.
 */
export function dedupeByMemoryIdentity<T extends { subject?: string; content: string; updatedAt?: string }>(
  rows: T[]
): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = memoryIdentityKey(row);
    const current = best.get(key);
    if (!current || String(row.updatedAt ?? "") > String(current.updatedAt ?? "")) {
      best.set(key, row);
    }
  }
  return rows.filter((row) => best.get(memoryIdentityKey(row)) === row);
}
