import type { DesktopComposerSuggestion } from "@molibot/desktop-contract";
import { parseProjectFileReferences } from "@molibot/shared/projectFileReference";

/**
 * What the suggestion menu renders. The server catalog carries commands, Skills
 * and Mini Apps; `file` entries are produced client-side from the Project file
 * search, so the kind is widened here instead of in the shared contract.
 */
export type ComposerMenuItem = Omit<DesktopComposerSuggestion, "kind"> & {
  kind: DesktopComposerSuggestion["kind"] | "file";
};

/** Every entity the highlight overlay can pill, including client-side file references. */
export type ComposerSegmentKind = DesktopComposerSuggestion["kind"] | "file";

/** One run of composer text: plain prose (`kind: null`) or a recognized invocation token. */
export interface ComposerSegment {
  text: string;
  kind: ComposerSegmentKind | null;
}

export interface ComposerInvocation {
  kind: DesktopComposerSuggestion["kind"];
  token: string;
  /** Characters occupied by the persisted selector representation. */
  consumedLength: number;
}

let catalog: DesktopComposerSuggestion[] = [];

export function setComposerSuggestionCatalog(items: DesktopComposerSuggestion[]): void {
  catalog = items;
}

/**
 * A leading `/command`, `/skill`, or `@miniapp` token is an invocation the UI
 * renders as a pill rather than as prose. Mirrors the server-side classifier in
 * `src/lib/server/app/composerSuggestions.ts`; both resolve against the same
 * catalog so an unknown token stays plain text.
 */
export function classifyComposerSuggestion(
  content: string,
  items: DesktopComposerSuggestion[] = catalog
): ComposerInvocation | null {
  const trimmed = String(content ?? "").trim();
  // The Runtime persists an explicit Skill selector as a compact Markdown
  // reference so the model can read the authoritative SKILL.md without
  // inlining the file. In the transcript this is still a Skill invocation,
  // not a user-authored link: keep the path out of the visible message and
  // consume the whole reference before rendering the remaining prose.
  const skillReference = trimmed.match(/^\[\$([^\]\r\n]+)\]\(([^\r\n]*?\/SKILL\.md)\)/i);
  if (skillReference) {
    return {
      kind: "skill",
      token: `$${skillReference[1]}`,
      consumedLength: skillReference[0].length
    };
  }
  const token = (trimmed.match(/^\/[a-z0-9][a-z0-9:_-]*/i) ?? trimmed.match(/^@[a-z0-9][a-z0-9:_-]*/i))?.[0]?.toLowerCase();
  if (!token) return null;
  const match = items.find((item) => item.label.toLowerCase() === token);
  return match ? { kind: match.kind, token, consumedLength: token.length } : null;
}

/**
 * Splits composer text into plain runs and recognized entities so the highlight
 * overlay can pill every `/command`, `/skill`, `@miniapp` and persisted
 * reference at any offset — not only a leading one. A bare token only counts at
 * a word boundary (message start or after whitespace), mirroring the suggestion
 * triggers, and an unknown token stays plain text. Persisted Markdown selectors
 * (`@[file.md](path)`, `[$Skill](.../SKILL.md)`) count anywhere: their shape is
 * specific enough that they only exist as real references, and they read as one
 * entity instead of link soup.
 */
export function segmentComposerInvocations(
  content: string,
  items: DesktopComposerSuggestion[] = catalog
): ComposerSegment[] {
  const text = String(content ?? "");
  const ranges: { start: number; end: number; kind: ComposerSegmentKind }[] = [];
  for (const reference of parseProjectFileReferences(text)) {
    ranges.push({ start: reference.start, end: reference.end, kind: "file" });
  }
  for (const match of text.matchAll(/\[\$[^\]\r\n]+\]\([^\r\n]*?\/SKILL\.md\)/gi)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length, kind: "skill" });
  }
  for (const match of text.matchAll(/[/@][a-z0-9][a-z0-9:_-]*/gi)) {
    const start = match.index ?? 0;
    if (start > 0 && !/\s/.test(text[start - 1])) continue;
    if (ranges.some((range) => start >= range.start && start < range.end)) continue;
    const hit = items.find((item) => item.label.toLowerCase() === match[0].toLowerCase());
    if (!hit) continue;
    ranges.push({ start, end: start + match[0].length, kind: hit.kind });
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: ComposerSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), kind: null });
    segments.push({ text: text.slice(range.start, range.end), kind: range.kind });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), kind: null });
  return segments;
}
