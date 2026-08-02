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

/**
 * Drops the cache so the next `ensureComposerSuggestions` refetches.
 *
 * The catalog carries Mini Apps, so installing, uninstalling or toggling one
 * changes what `@` may offer. Without this the composer keeps advertising an
 * app that no longer exists — or hides one the owner just installed — until the
 * WebView reloads. Settings and Chat share one WebView, so the mutation and the
 * stale consumer are always live at the same time.
 */
export function invalidateComposerSuggestions(): void {
  composerSuggestionsStore.endpoint = "";
}

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

export function classifyComposerInvocation(content: string): { kind: DesktopComposerSuggestion["kind"]; token: string } | null {
  return classifyComposerSuggestion(content, composerSuggestionsStore.items);
}

/** Segments composer text against the live catalog for the highlight overlay. */
export function segmentComposerValue(content: string): ComposerSegment[] {
  return segmentComposerInvocations(content, composerSuggestionsStore.items);
}
