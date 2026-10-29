import { normalizePiProviderId } from "$lib/server/providers/piRegistry.js";

const REMOVED_PROVIDER_IDS = new Set(["google-antigravity", "google-gemini-cli"]);

/** Canonical provider rows for both settings writes and persisted settings reads. */
export function normalizeProviderConfigRows(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) return [];
  const rows = input.filter((row): row is Record<string, unknown> =>
    row !== null && typeof row === "object" && !Array.isArray(row)
  );
  const currentIds = new Set(rows.map(row => String(row.id ?? "").trim()));
  return rows.flatMap(row => {
    const oldId = String(row.id ?? "").trim();
    if (REMOVED_PROVIDER_IDS.has(oldId)) return [];
    const id = normalizePiProviderId(oldId);
    // An explicitly stored current identity takes precedence over its obsolete duplicate.
    if (id !== oldId && currentIds.has(id)) return [];
    const name = row.name === `[Built-in] ${oldId}` ? `[Built-in] ${id}` : row.name;
    return [{ ...row, id, name }];
  });
}
