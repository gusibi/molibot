import type { DesktopComposerSuggestion } from "@molibot/desktop-contract";

/**
 * What the suggestion menu renders. The server catalog carries commands, Skills
 * and Mini Apps; `file` entries are produced client-side from the Project file
 * search, so the kind is widened here instead of in the shared contract.
 */
export type ComposerMenuItem = Omit<DesktopComposerSuggestion, "kind"> & {
  kind: DesktopComposerSuggestion["kind"] | "file";
};

/** One run of composer text: plain prose (`kind: null`) or a recognized invocation token. */
export interface ComposerSegment {
  text: string;
  kind: DesktopComposerSuggestion["kind"] | null;
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
): { kind: DesktopComposerSuggestion["kind"]; token: string } | null {
  const trimmed = String(content ?? "").trim();
  const token = (trimmed.match(/^\/[a-z0-9][a-z0-9:_-]*/i) ?? trimmed.match(/^@[a-z0-9][a-z0-9:_-]*/i))?.[0]?.toLowerCase();
  if (!token) return null;
  const match = items.find((item) => item.label.toLowerCase() === token);
  return match ? { kind: match.kind, token } : null;
}

/**
 * Splits composer text into plain runs and recognized invocation tokens so the
 * highlight overlay can pill every `/command`, `/skill` or `@miniapp` at any
 * offset — not only a leading one. A candidate only counts at a word boundary
 * (message start or after whitespace), mirroring the suggestion triggers, and
 * an unknown token stays plain text.
 */
export function segmentComposerInvocations(
  content: string,
  items: DesktopComposerSuggestion[] = catalog
): ComposerSegment[] {
  const text = String(content ?? "");
  const segments: ComposerSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/[/@][a-z0-9][a-z0-9:_-]*/gi)) {
    const start = match.index ?? 0;
    if (start > 0 && !/\s/.test(text[start - 1])) continue;
    const hit = items.find((item) => item.label.toLowerCase() === match[0].toLowerCase());
    if (!hit) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), kind: null });
    segments.push({ text: match[0], kind: hit.kind });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), kind: null });
  return segments;
}
