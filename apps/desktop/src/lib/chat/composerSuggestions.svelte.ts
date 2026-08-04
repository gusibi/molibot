import type { DesktopComposerSuggestion } from "@molibot/desktop-contract";
import { loadDesktopComposerSuggestions } from "../api";
import {
  classifyComposerSuggestion,
  segmentComposerInvocations,
  setComposerSuggestionCatalog,
  type ComposerSegment
} from "./composerSuggestionCatalog";

export const composerSuggestionsStore = $state({
  endpoint: "",
  items: [] as DesktopComposerSuggestion[]
});

/** The endpoint/projectId the cached catalog was loaded for. */
let lastEndpoint = "";
let lastProjectId = "";

/**
 * Drops the cache and immediately reloads the catalog for whatever the composer
 * is currently showing.
 *
 * The catalog carries Mini Apps and a Project's custom commands, so installing,
 * uninstalling or toggling an app — or editing the commands in Project settings
 * — changes what `@` and `/` may offer. Settings and Chat share one WebView, so
 * the mutation and the stale consumer are always live at the same time; a mere
 * cache-clear is not enough, because `ChatInputArea`'s legacy `$:` tracks only
 * its own `endpoint`/`projectId` props and will not re-run on a store change
 * from another module (pitfall 2). Refetch here instead.
 */
export function invalidateComposerSuggestions(): void {
  composerSuggestionsStore.endpoint = "";
  if (lastEndpoint) void ensureComposerSuggestions(lastEndpoint, lastProjectId);
}

export async function ensureComposerSuggestions(endpoint: string, projectId = ""): Promise<void> {
  const cacheKey = `${endpoint}::${projectId}`;
  if (!endpoint || cacheKey === composerSuggestionsStore.endpoint) return;
  composerSuggestionsStore.endpoint = cacheKey;
  lastEndpoint = endpoint;
  lastProjectId = projectId;
  try {
    const items = await loadDesktopComposerSuggestions(endpoint, projectId);
    // A late response must never overwrite a newer selection (pitfall 3).
    if (composerSuggestionsStore.endpoint !== cacheKey) return;
    composerSuggestionsStore.items = items;
    setComposerSuggestionCatalog(items);
  } catch {
    if (composerSuggestionsStore.endpoint === cacheKey) composerSuggestionsStore.items = [];
  }
}

export function classifyComposerInvocation(content: string): { kind: DesktopComposerSuggestion["kind"]; token: string } | null {
  return classifyComposerSuggestion(content, composerSuggestionsStore.items);
}

/** Segments composer text against the live catalog for the highlight overlay. */
export function segmentComposerValue(content: string): ComposerSegment[] {
  return segmentComposerInvocations(content, composerSuggestionsStore.items);
}
