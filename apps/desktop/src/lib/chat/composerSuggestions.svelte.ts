import type { DesktopComposerSuggestion } from "@molibot/desktop-contract";
import { loadDesktopComposerSuggestions } from "../api";
import { classifyComposerSuggestion, setComposerSuggestionCatalog } from "./composerSuggestionCatalog";

export const composerSuggestionsStore = $state({
  endpoint: "",
  items: [] as DesktopComposerSuggestion[]
});

export async function ensureComposerSuggestions(endpoint: string, projectId = ""): Promise<void> {
  const cacheKey = `${endpoint}::${projectId}`;
  if (!endpoint || cacheKey === composerSuggestionsStore.endpoint) return;
  composerSuggestionsStore.endpoint = cacheKey;
  try {
    composerSuggestionsStore.items = await loadDesktopComposerSuggestions(endpoint, projectId);
    setComposerSuggestionCatalog(composerSuggestionsStore.items);
  } catch {
    if (composerSuggestionsStore.endpoint === cacheKey) composerSuggestionsStore.items = [];
  }
}

export function classifyComposerInvocation(content: string): { kind: "command" | "skill"; token: string } | null {
  return classifyComposerSuggestion(content, composerSuggestionsStore.items);
}
