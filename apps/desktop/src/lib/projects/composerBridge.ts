import { writable } from "svelte/store";
import { formatProjectFileReference } from "@molibot/shared/projectFileReference";
import type { MiniAppComposerInsertMode } from "@molibot/shared/miniappBridge";

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

export interface MiniAppComposerInsertion {
  id: number;
  text: string;
  mode: MiniAppComposerInsertMode;
  scope: "session" | "project";
}

const miniAppInsertion = writable<MiniAppComposerInsertion | null>(null);
export const miniAppComposerInsertion = { subscribe: miniAppInsertion.subscribe };

/**
 * A bridge v2 `composer.attach` request.
 *
 * Carries the app id alongside the locator because the host has to ask *that*
 * app for the bytes — the path alone is meaningless, and resolving it anywhere
 * but against the declaring app's own data directory would be the bug this
 * shape exists to prevent.
 */
export interface MiniAppComposerAttachment {
  id: number;
  appId: string;
  /** Path relative to the App's own data directory. */
  path: string;
  name: string;
  scope: "session" | "project";
}

const miniAppAttachment = writable<MiniAppComposerAttachment | null>(null);
export const miniAppComposerAttachment = { subscribe: miniAppAttachment.subscribe };

/** A bridge v2 `chat.openSession` request. */
export interface MiniAppSessionOpen {
  id: number;
  sessionId: string;
  scope: "session" | "project";
}

const miniAppSessionOpen = writable<MiniAppSessionOpen | null>(null);
export const miniAppSessionOpenRequest = { subscribe: miniAppSessionOpen.subscribe };

/**
 * A request to follow a Mini App deep link (`molibot://miniapp/<id>/<path>`).
 *
 * Routed through this store rather than a prop because the inspector that has
 * to open is owned by `ChatView`, while a result card can be rendered two
 * levels down inside `ProjectChat`. Threading a callback through
 * `ProjectDetail` would make an intermediate component carry a concern it has
 * nothing to do with; this is the same seam the other Mini App UI intents
 * already use.
 */
export interface MiniAppDeepLinkOpen {
  id: number;
  link: string;
}

const miniAppDeepLinkOpen = writable<MiniAppDeepLinkOpen | null>(null);
export const miniAppDeepLinkOpenRequest = { subscribe: miniAppDeepLinkOpen.subscribe };

let sequence = 0;

/** Formats a file reference the way the composer should show it. */
export function formatFileReference(path: string, line = 0): string {
  return formatProjectFileReference(path, line);
}

export function requestComposerInsertion(path: string, line = 0): void {
  insertion.set({ id: ++sequence, reference: formatFileReference(path, line) });
}

export function requestMiniAppComposerInsertion(
  text: string,
  mode: MiniAppComposerInsertMode,
  scope: "session" | "project"
): void {
  miniAppInsertion.set({ id: ++sequence, text, mode, scope });
}

export function requestMiniAppComposerAttachment(
  appId: string,
  path: string,
  name: string,
  scope: "session" | "project"
): void {
  miniAppAttachment.set({ id: ++sequence, appId, path, name, scope });
}

export function requestMiniAppSessionOpen(sessionId: string, scope: "session" | "project"): void {
  miniAppSessionOpen.set({ id: ++sequence, sessionId, scope });
}

export function requestMiniAppDeepLinkOpen(link: string): void {
  miniAppDeepLinkOpen.set({ id: ++sequence, link });
}

export function insertComposerText(current: string, text: string, mode: MiniAppComposerInsertMode): string {
  if (mode === "replace") return text;
  if (!current || !text) return `${current}${text}`;
  return `${current.replace(/\n+$/, "")}\n${text.replace(/^\n+/, "")}`;
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
