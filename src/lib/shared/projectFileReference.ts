export interface ParsedProjectFileReference {
  raw: string;
  displayName: string;
  path: string;
  line?: number;
  start: number;
  end: number;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function escapeTarget(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function unescapeReferencePart(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\" && index + 1 < value.length) {
      result += value[index + 1];
      index += 1;
    } else {
      result += value[index];
    }
  }
  return result;
}

function readEscapedUntil(text: string, start: number, delimiter: string): { value: string; end: number } | null {
  let value = "";
  for (let index = start; index < text.length; index += 1) {
    const current = text[index];
    if (current === "\\" && index + 1 < text.length) {
      value += current + text[index + 1];
      index += 1;
      continue;
    }
    if (current === delimiter) return { value, end: index };
    value += current;
  }
  return null;
}

function splitLineSuffix(target: string): { path: string; line?: number } {
  const match = target.match(/^(.*):([1-9]\d*)$/);
  if (!match?.[1]) return { path: target };
  return { path: match[1], line: Number(match[2]) };
}

function fileNameFromPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || normalized;
}

/**
 * Render a Project file reference for the composer/transcript. The leading `@`
 * is presentation syntax only; the link target is the authoritative Project-
 * relative path that the Runtime validates before exposing it to the model.
 */
export function formatProjectFileReference(path: string, line = 0): string {
  const normalizedPath = String(path ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const suffix = line > 0 ? `:${Math.floor(line)}` : "";
  const label = `${fileNameFromPath(normalizedPath)}${suffix}`;
  return `@[${escapeLabel(label)}](${escapeTarget(`${normalizedPath}${suffix}`)})`;
}

/** Parse only the explicit `@[label](path)` form; a bare `@path` stays prose. */
export function parseProjectFileReferences(text: string): ParsedProjectFileReference[] {
  const source = String(text ?? "");
  const references: ParsedProjectFileReference[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("@[", cursor);
    if (start < 0) break;
    const label = readEscapedUntil(source, start + 2, "]");
    if (!label || source[label.end + 1] !== "(") {
      cursor = start + 2;
      continue;
    }
    const target = readEscapedUntil(source, label.end + 2, ")");
    if (!target) {
      cursor = label.end + 2;
      continue;
    }
    const displayName = unescapeReferencePart(label.value).trim();
    const decodedTarget = unescapeReferencePart(target.value).trim();
    const split = splitLineSuffix(decodedTarget);
    const end = target.end + 1;
    if (displayName && split.path) {
      references.push({
        raw: source.slice(start, end),
        displayName,
        path: split.path,
        ...(split.line ? { line: split.line } : {}),
        start,
        end
      });
    }
    cursor = end;
  }
  return references;
}
