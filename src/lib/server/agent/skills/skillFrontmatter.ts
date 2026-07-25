import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * Skill frontmatter parsing and emission.
 *
 * Parsing used to be a hand-rolled YAML subset (quoted scalars plus `|`/`>`
 * block scalars) which silently mis-parsed lists, nested maps and anchors. It
 * now goes through pi, which uses a real YAML parser.
 *
 * The `Record<string, string> | null` shape is kept deliberately: every caller
 * reads flat string fields, and `null` means "no frontmatter block". Non-scalar
 * values are serialized as JSON so `parseStringList` in skills.ts — which
 * already accepts a JSON array literal — keeps working for `mcpServers`,
 * `aliases` and the `signals_*` fields.
 */
const FRONTMATTER_BLOCK = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

/** Values YAML would read back as a bool/null rather than a string. */
const YAML_RESERVED_WORDS = /^(y|n|yes|no|true|false|on|off|null|~)$/i;

/**
 * Quote a value for use as a YAML scalar.
 *
 * Only quotes when the raw text would be ambiguous, so ordinary values stay
 * readable. This matters because skill descriptions routinely contain `": "`
 * (e.g. `Reusable workflow draft for: <user message>`), which a real YAML
 * parser rejects as a nested mapping.
 */
export function formatYamlScalar(value: string): string {
  const text = String(value ?? "");
  if (text === "") return '""';

  const ambiguous =
    /:\s/.test(text) ||
    text.endsWith(":") ||
    /\s#/.test(text) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) ||
    /^\s|\s$/.test(text) ||
    /[\n\r\t]/.test(text) ||
    YAML_RESERVED_WORDS.test(text) ||
    // Anything numeric-looking would come back as a number.
    (text.trim() !== "" && !Number.isNaN(Number(text)));

  // JSON string syntax is a valid YAML double-quoted scalar.
  return ambiguous ? JSON.stringify(text) : text;
}

/** Render a YAML flow sequence, quoting entries only where needed. */
export function formatYamlList(values: readonly string[]): string {
  const items = values.map((value) => {
    const text = String(value ?? "");
    // Commas and brackets additionally terminate a value inside flow context.
    return /[,[\]{}]/.test(text) ? JSON.stringify(text) : formatYamlScalar(text);
  });
  return `[${items.join(", ")}]`;
}

function coerceScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? "";
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function foldYamlBlock(lines: string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }

  return paragraphs.join("\n\n").trim();
}

function parseBlockScalar(
  lines: string[],
  start: number,
  style: "folded" | "literal"
): { value: string; nextIndex: number } {
  const block: string[] = [];
  let index = start;
  for (; index < lines.length; index += 1) {
    const candidate = lines[index];
    if (candidate.trim() === "") {
      block.push("");
      continue;
    }
    if (!/^\s+/.test(candidate)) {
      break;
    }
    block.push(candidate.replace(/^\s+/, ""));
  }
  return {
    value: style === "literal" ? block.join("\n").trim() : foldYamlBlock(block),
    nextIndex: index
  };
}

/**
 * Line-based reader for frontmatter that is not valid YAML.
 *
 * Skill files written before the emitters started quoting scalars are still on
 * disk (and users hand-write skills too), so a parse failure must not make an
 * existing skill disappear. This is the previous parser, kept as a fallback
 * only — new files are emitted as valid YAML.
 */
function parseLegacyFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) return null;

  const data: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const field = rawLine.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!field) continue;
    const key = field[1]?.trim();
    const rawValue = field[2] ?? "";
    if (!key) continue;

    if (/^[>|][+-]?\d*$/.test(rawValue.trim())) {
      const style = rawValue.trim().startsWith("|") ? "literal" : "folded";
      const parsed = parseBlockScalar(lines, index + 1, style);
      data[key] = parsed.value;
      index = parsed.nextIndex - 1;
      continue;
    }

    data[key] = stripQuotes(rawValue);
  }

  return data;
}

export function parseSkillFrontmatter(content: string): Record<string, string> | null {
  if (!FRONTMATTER_BLOCK.test(content)) return null;

  let frontmatter: Record<string, unknown>;
  try {
    ({ frontmatter } = parseFrontmatter<Record<string, unknown>>(content));
  } catch {
    return parseLegacyFrontmatter(content);
  }

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    data[key] = coerceScalar(value);
  }
  return data;
}
