import type { DesktopComposerSuggestion } from "@molibot/desktop-contract";

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
