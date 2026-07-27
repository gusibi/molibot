import { watch, type FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import type { Ignore } from "ignore";
import { loadGitignore } from "./inspection.js";
import { ALWAYS_SKIP_DIRECTORIES } from "./search.js";
import type { ProjectRecord } from "./store.js";

const DEBOUNCE_MS = 250;
/**
 * Past this many distinct paths in one batch we stop enumerating and tell the
 * client to refresh wholesale — a `git checkout` or `pnpm install` can produce
 * tens of thousands of events and the per-path list stops being useful.
 */
const MAX_BATCH_PATHS = 200;

export interface ProjectChangeBatch {
  /** Project-relative paths that changed. Empty when `overflow` is set. */
  paths: string[];
  overflow: boolean;
}

export type ProjectWatchListener = (batch: ProjectChangeBatch) => void;

interface RootWatch {
  watcher: FSWatcher;
  listeners: Set<ProjectWatchListener>;
  pending: Set<string>;
  overflow: boolean;
  timer: NodeJS.Timeout | null;
  gitignore: Ignore | null;
}

const watchesByRoot = new Map<string, RootWatch>();

function isNoise(relPath: string, gitignore: Ignore | null): boolean {
  if (!relPath) return true;
  const segments = relPath.split("/");
  if (segments.some((segment) => ALWAYS_SKIP_DIRECTORIES.has(segment))) return true;
  // Editors write `foo.ts~`, `.foo.ts.swp` and `4913` probe files on save.
  const name = segments[segments.length - 1];
  if (name.endsWith("~") || name.endsWith(".swp") || name.endsWith(".swx") || name.startsWith(".#")) return true;
  if (gitignore?.ignores(relPath)) return true;
  return false;
}

function flush(root: string): void {
  const entry = watchesByRoot.get(root);
  if (!entry) return;
  entry.timer = null;
  const batch: ProjectChangeBatch = entry.overflow
    ? { paths: [], overflow: true }
    : { paths: [...entry.pending], overflow: false };
  entry.pending.clear();
  entry.overflow = false;
  if (!batch.overflow && !batch.paths.length) return;
  for (const listener of [...entry.listeners]) {
    try {
      listener(batch);
    } catch {
      // A failing subscriber must not take the shared watcher down.
    }
  }
}

function schedule(root: string): void {
  const entry = watchesByRoot.get(root);
  if (!entry || entry.timer) return;
  entry.timer = setTimeout(() => flush(root), DEBOUNCE_MS);
  entry.timer.unref?.();
}

function teardown(root: string): void {
  const entry = watchesByRoot.get(root);
  if (!entry || entry.listeners.size) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  watchesByRoot.delete(root);
}

/**
 * Subscribes to file changes under the Project root and returns an unsubscribe
 * function. Watchers are shared and reference-counted per real root path, so
 * several open panels on the same Project cost one OS watch.
 *
 * Rejects if the platform cannot watch the directory recursively; callers are
 * expected to fall back to manual refresh rather than treat that as fatal.
 */
export async function watchProject(project: ProjectRecord, listener: ProjectWatchListener): Promise<() => void> {
  const root = await fs.realpath(project.rootPath);
  let entry = watchesByRoot.get(root);
  if (!entry) {
    const gitignore = await loadGitignore(root);
    const watcher = watch(root, { recursive: true, persistent: false });
    const created: RootWatch = { watcher, listeners: new Set(), pending: new Set(), overflow: false, timer: null, gitignore };
    watcher.on("change", (_event, filename) => {
      const current = watchesByRoot.get(root);
      if (!current) return;
      const relPath = String(filename ?? "").replaceAll("\\", "/");
      if (isNoise(relPath, current.gitignore)) return;
      if (current.pending.size >= MAX_BATCH_PATHS) current.overflow = true;
      else current.pending.add(relPath);
      schedule(root);
    });
    watcher.on("error", () => {
      const current = watchesByRoot.get(root);
      if (!current) return;
      current.overflow = true;
      schedule(root);
    });
    watchesByRoot.set(root, created);
    entry = created;
  }

  entry.listeners.add(listener);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = watchesByRoot.get(root);
    if (!current) return;
    current.listeners.delete(listener);
    teardown(root);
  };
}

/** Test helper: closes every shared watcher. */
export function closeAllProjectWatchers(): void {
  for (const root of [...watchesByRoot.keys()]) {
    const entry = watchesByRoot.get(root);
    if (!entry) continue;
    entry.listeners.clear();
    teardown(root);
  }
}
