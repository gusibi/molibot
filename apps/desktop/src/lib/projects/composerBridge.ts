import { writable } from "svelte/store";
import { formatProjectFileReference } from "@molibot/shared/projectFileReference";

/**
 * One-way channel from the Project file panel to the Project chat composer.
 *
 * The panel lives in `ChatView` while the composer lives inside `ProjectChat`,
 * so there is no prop path between them. This is a plain Svelte store rather
 * than a runes `$state` on purpose: `ProjectChat` is a legacy `$:` component
 * and cannot track runes state owned by another module (memory
 * `desktop-controller-legacy-reactivity`), but `$composerInsertion` works.
 *
 * Each request carries a monotonic `id` so the consumer can tell a repeated
 * insertion of the same path from a stale re-run of its reactive block.
 */
export interface ComposerInsertion {
  id: number;
  /** Project-relative path, optionally suffixed with `:line`. */
  reference: string;
}

const insertion = writable<ComposerInsertion | null>(null);

export const composerInsertion = { subscribe: insertion.subscribe };

let sequence = 0;

/** Formats a file reference the way the composer should show it. */
export function formatFileReference(path: string, line = 0): string {
  return formatProjectFileReference(path, line);
}

export function requestComposerInsertion(path: string, line = 0): void {
  insertion.set({ id: ++sequence, reference: formatFileReference(path, line) });
}

/**
 * Appends a reference to the current composer text, keeping exactly one space
 * between it and whatever the user already typed, and leaving a trailing space
 * so they can keep typing.
 */
export function appendReference(current: string, reference: string): string {
  if (!current.trim()) return `${reference} `;
  return `${current.replace(/\s+$/, "")} ${reference} `;
}
