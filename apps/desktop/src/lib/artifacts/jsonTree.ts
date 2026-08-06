/**
 * JSON tree flattening for the Artifact Panel's `json` viewer (PRD §3.38
 * Slice 2).
 *
 * The parsing and row projection live here rather than in the component so the
 * collapse rules, the depth default and the size ceiling are unit-testable
 * without a DOM. The viewer only renders rows and toggles a set of collapsed
 * paths.
 */

/** Above this the tree is not worth building: the caller falls back to source. */
export const JSON_TREE_MAX_BYTES = 1024 * 1024;

/** Containers deeper than this start collapsed, so a big document opens readable. */
export const JSON_TREE_DEFAULT_DEPTH = 2;

export type JsonValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonTreeRow {
  /** Stable identity: the JSON Pointer-ish path from the root. */
  path: string;
  /** Nesting level; the root's children are level 0. */
  depth: number;
  /** Object key or array index; empty for the root value itself. */
  key: string;
  kind: JsonValueKind;
  /** Rendered scalar text; empty for containers. */
  value: string;
  /** True when this row opens a container the user can collapse. */
  expandable: boolean;
  /** Child count for containers, so a collapsed row still reports its size. */
  childCount: number;
}

export type JsonTreeResult =
  | { status: "ok"; rows: JsonTreeRow[]; collapsedByDefault: string[] }
  | { status: "too-large"; sizeBytes: number }
  | { status: "invalid"; message: string };

function kindOf(value: unknown): JsonValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type === "object") return "object";
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  return "string";
}

function scalarText(value: unknown, kind: JsonValueKind): string {
  if (kind === "string") return JSON.stringify(value);
  if (kind === "null") return "null";
  if (kind === "number" || kind === "boolean") return String(value);
  return "";
}

/**
 * Byte length rather than string length: a CJK-heavy document is ~3x its
 * character count in UTF-8, and the ceiling exists to bound render cost, not
 * character count (pitfall #8).
 */
export function jsonByteLength(content: string): number {
  return new TextEncoder().encode(String(content ?? "")).length;
}

/**
 * Parses JSON into flat rows. Returns a discriminated result rather than
 * throwing: every failure mode has a visible fallback in the viewer, so none of
 * them may surface as a blank tab.
 */
export function buildJsonTree(content: string): JsonTreeResult {
  const source = String(content ?? "");
  const sizeBytes = jsonByteLength(source);
  if (sizeBytes > JSON_TREE_MAX_BYTES) return { status: "too-large", sizeBytes };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    return { status: "invalid", message: cause instanceof Error ? cause.message : String(cause) };
  }

  const rows: JsonTreeRow[] = [];
  const collapsedByDefault: string[] = [];

  const walk = (value: unknown, key: string, path: string, depth: number): void => {
    const kind = kindOf(value);
    const entries: Array<[string, unknown]> =
      kind === "object"
        ? Object.entries(value as Record<string, unknown>)
        : kind === "array"
          ? (value as unknown[]).map((item, index) => [String(index), item] as [string, unknown])
          : [];
    const expandable = kind === "object" || kind === "array";

    rows.push({
      path,
      depth,
      key,
      kind,
      value: scalarText(value, kind),
      expandable,
      childCount: entries.length
    });

    if (!expandable) return;
    // Deep containers start collapsed; the row itself stays visible so the user
    // can see that something is there and open it.
    if (depth >= JSON_TREE_DEFAULT_DEPTH && entries.length > 0) collapsedByDefault.push(path);
    for (const [childKey, childValue] of entries) {
      walk(childValue, childKey, `${path}/${childKey}`, depth + 1);
    }
  };

  walk(parsed, "", "", 0);
  return { status: "ok", rows, collapsedByDefault };
}

/**
 * Filters the flat rows down to what is currently visible. A row is hidden when
 * any ancestor path is collapsed; testing by path prefix keeps this independent
 * of row order assumptions.
 */
export function visibleJsonRows(rows: JsonTreeRow[], collapsed: ReadonlySet<string>): JsonTreeRow[] {
  if (collapsed.size === 0) return rows;
  return rows.filter((row) => {
    for (const path of collapsed) {
      // A collapsed container hides its descendants, never itself.
      if (row.path !== path && row.path.startsWith(`${path}/`)) return false;
    }
    return true;
  });
}
