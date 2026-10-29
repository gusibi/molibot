/**
 * Frontmatter as display rows.
 *
 * The shared parser stringifies non-scalar values, so a nested map arrives as
 * JSON text. Expanding it into dotted keys keeps `metadata.openclaw.emoji` one
 * readable row instead of a JSON blob, while anything that is not JSON stays a
 * single scalar row.
 */

function formatFrontmatterValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => (entry && typeof entry === "object" ? JSON.stringify(entry) : String(entry))).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function flattenSkillFrontmatter(flat: Record<string, string> | null): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  const walk = (prefix: string, value: unknown): void => {
    if (Array.isArray(value)) {
      rows.push({ key: prefix, value: formatFrontmatterValue(value) });
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(prefix ? `${prefix}.${key}` : key, child);
      return;
    }
    rows.push({ key: prefix, value: formatFrontmatterValue(value) });
  };
  for (const [key, raw] of Object.entries(flat ?? {})) {
    const text = String(raw ?? "");
    const trimmed = text.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        walk(key, JSON.parse(trimmed) as unknown);
        continue;
      } catch {
        // Not JSON after all — keep the literal text.
      }
    }
    rows.push({ key, value: text });
  }
  return rows;
}
