import type { DesktopComposerSuggestion } from "@molibot/desktop-contract";

let catalog: DesktopComposerSuggestion[] = [];

export function setComposerSuggestionCatalog(items: DesktopComposerSuggestion[]): void {
  catalog = items;
}

export function classifyComposerSuggestion(
  content: string,
  items: DesktopComposerSuggestion[] = catalog
): { kind: "command" | "skill"; token: string } | null {
  const token = String(content ?? "").trim().match(/^\/[a-z0-9][a-z0-9:_-]*/i)?.[0]?.toLowerCase();
  if (!token) return null;
  const match = items.find((item) => item.label.toLowerCase() === token);
  return match ? { kind: match.kind, token } : null;
}
