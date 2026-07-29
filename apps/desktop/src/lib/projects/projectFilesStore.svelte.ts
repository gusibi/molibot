import {
  desktopProjectRawFileUrl,
  loadDesktopProjectFile,
  loadDesktopProjectGitDiff,
  loadDesktopProjectGitStatus,
  loadDesktopProjectTree,
  revealDesktopProjectFile,
  searchDesktopProjectFiles,
  watchDesktopProjectFiles,
  type DesktopProjectChangeBatch,
  type DesktopProjectFilePreview,
  type DesktopProjectGitDiff,
  type DesktopProjectGitStatus,
  type DesktopProjectSearchResult,
  type DesktopProjectTreeEntry
} from "../api";

/** One directory level of the tree, keyed in `dirs` by its Project-relative path ("" is the root). */
export interface TreeLevel {
  entries: DesktopProjectTreeEntry[];
  nextCursor: string;
  loading: boolean;
  error: string;
}

export type OpenTabKind = "file" | "diff";

export interface OpenTab {
  id: string;
  kind: OpenTabKind;
  path: string;
  name: string;
  loading: boolean;
  error: string;
  preview: DesktopProjectFilePreview | null;
  diff: DesktopProjectGitDiff | null;
  /** 1-based line the viewer should scroll to once content arrives; 0 means none. */
  revealLine: number;
  /** True while another byte window is being appended to a partially loaded file. */
  loadingMore: boolean;
  /** Byte position the next window starts at; equals `sizeBytes` once fully loaded. */
  loadedBytes: number;
}

export type SearchMode = "name" | "content";

export interface FlatTreeRow {
  path: string;
  name: string;
  kind: DesktopProjectTreeEntry["kind"];
  depth: number;
  expanded: boolean;
}

/**
 * Flattens the loaded tree levels into the rows the panel actually renders, in
 * visual order. Keyboard navigation walks this list, so it must be derived from
 * `dirs` and `expanded` explicitly — a template helper that read them itself
 * would not re-run when either changes.
 */
export function flattenTree(
  dirs: Record<string, TreeLevel>,
  expanded: Record<string, boolean>,
  dirPath = "",
  depth = 0
): FlatTreeRow[] {
  const level = dirs[dirPath];
  if (!level) return [];
  const rows: FlatTreeRow[] = [];
  for (const entry of level.entries) {
    const isOpen = Boolean(expanded[entry.path]);
    rows.push({ path: entry.path, name: entry.name, kind: entry.kind, depth, expanded: isOpen });
    if (entry.kind === "directory" && isOpen) {
      rows.push(...flattenTree(dirs, expanded, entry.path, depth + 1));
    }
  }
  return rows;
}

const MAX_OPEN_TABS = 12;

function tabId(kind: OpenTabKind, path: string): string {
  return `${kind}:${path}`;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/**
 * Owns everything the Project file panel shows: the lazily expanded tree, the
 * open-file tab strip, Git status, search, and the file-change subscription.
 *
 * Every async load carries a generation counter plus its owner key (directory
 * path / tab id) and re-validates before writing, so a slow response can never
 * overwrite what the user selected in the meantime.
 */
export class ProjectFilesStore {
  endpoint = $state("");
  projectId = $state("");

  dirs = $state<Record<string, TreeLevel>>({});
  expanded = $state<Record<string, boolean>>({});
  /** Row the tree's roving focus sits on; drives arrow-key navigation. */
  cursorPath = $state("");

  tabs = $state<OpenTab[]>([]);
  activeTabId = $state("");

  git = $state<DesktopProjectGitStatus | null>(null);
  gitLoading = $state(false);
  gitError = $state("");

  searchOpen = $state(false);
  searchMode = $state<SearchMode>("name");
  searchQuery = $state("");
  searchResult = $state<DesktopProjectSearchResult | null>(null);
  searchLoading = $state(false);
  searchError = $state("");

  /** True once the change stream is live; false means "use the refresh button". */
  watching = $state(false);

  #generation = 0;
  #searchGeneration = 0;
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  #searchAbort: AbortController | null = null;
  #watchAbort: AbortController | null = null;
  #gitRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  get activeTab(): OpenTab | null {
    return this.tabs.find((tab) => tab.id === this.activeTabId) ?? null;
  }

  /**
   * Points the store at a Project. Resets all view state and restarts the change
   * stream; the generation bump invalidates every in-flight request from the
   * previous Project.
   */
  connect(endpoint: string, projectId: string): void {
    if (this.endpoint === endpoint && this.projectId === projectId) return;
    this.#generation += 1;
    this.endpoint = endpoint;
    this.projectId = projectId;
    this.dirs = {};
    this.expanded = {};
    this.cursorPath = "";
    this.tabs = [];
    this.activeTabId = "";
    this.git = null;
    this.gitError = "";
    this.searchQuery = "";
    this.searchResult = null;
    this.searchError = "";
    this.searchOpen = false;
    this.#restartWatch();
    if (projectId) {
      void this.loadDir("", { force: true });
      void this.loadGit();
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#watchAbort?.abort();
    this.#watchAbort = null;
    this.#searchAbort?.abort();
    this.#searchAbort = null;
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    if (this.#gitRefreshTimer) clearTimeout(this.#gitRefreshTimer);
    this.watching = false;
  }

  // ── Tree ────────────────────────────────────────────────────────────────

  async loadDir(path: string, options: { force?: boolean; append?: boolean } = {}): Promise<void> {
    if (!this.projectId) return;
    const existing = this.dirs[path];
    if (existing && !options.force && !options.append) return;
    if (options.append && (!existing?.nextCursor || existing.loading)) return;

    const generation = this.#generation;
    const cursor = options.append ? existing?.nextCursor : undefined;
    this.dirs = {
      ...this.dirs,
      // Keep the current entries visible while reloading so the tree does not flicker.
      [path]: { entries: existing?.entries ?? [], nextCursor: existing?.nextCursor ?? "", loading: true, error: "" }
    };

    try {
      const page = await loadDesktopProjectTree(this.endpoint, this.projectId, path, cursor);
      if (generation !== this.#generation) return;
      const previous = this.dirs[path];
      this.dirs = {
        ...this.dirs,
        [path]: {
          entries: options.append ? [...(previous?.entries ?? []), ...page.entries] : page.entries,
          nextCursor: page.nextCursor ?? "",
          loading: false,
          error: ""
        }
      };
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.dirs = {
        ...this.dirs,
        [path]: {
          entries: this.dirs[path]?.entries ?? [],
          nextCursor: this.dirs[path]?.nextCursor ?? "",
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause)
        }
      };
    }
  }

  toggleDir(path: string): void {
    const next = !this.expanded[path];
    this.expanded = { ...this.expanded, [path]: next };
    if (next) void this.loadDir(path);
  }

  collapseAllDirs(): void {
    this.expanded = {};
  }

  /**
   * Expands every ancestor of `path` so a search hit or an agent-touched file
   * becomes visible in the tree, loading the levels that were never opened.
   */
  async revealPath(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let prefix = "";
    const expanded = { ...this.expanded };
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      expanded[prefix] = true;
    }
    this.expanded = expanded;
    prefix = "";
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      await this.loadDir(prefix);
    }
  }

  /**
   * Opens a directory and everything above it. Unlike `toggleDir` this is
   * idempotent, so a breadcrumb click on an already-open folder does not close it.
   */
  async expandDir(path: string): Promise<void> {
    await this.revealPath(path);
    if (!this.expanded[path]) this.expanded = { ...this.expanded, [path]: true };
    await this.loadDir(path);
  }

  // ── Tabs ────────────────────────────────────────────────────────────────

  async openFile(path: string, options: { revealLine?: number } = {}): Promise<void> {
    await this.#openTab("file", path, options.revealLine ?? 0);
  }

  async openDiff(path: string): Promise<void> {
    await this.#openTab("diff", path, 0);
  }

  async #openTab(kind: OpenTabKind, path: string, revealLine: number): Promise<void> {
    const id = tabId(kind, path);
    const existing = this.tabs.find((tab) => tab.id === id);
    this.activeTabId = id;
    if (existing) {
      existing.revealLine = revealLine;
      if (!existing.loading && !existing.error && (existing.preview || existing.diff)) return;
    } else {
      const tab: OpenTab = {
        id, kind, path, name: baseName(path),
        loading: true, error: "", preview: null, diff: null, revealLine,
        loadingMore: false, loadedBytes: 0
      };
      const next = [...this.tabs, tab];
      // Drop the least-recently-opened tab that is not the one being opened.
      this.tabs = next.length > MAX_OPEN_TABS ? next.slice(next.length - MAX_OPEN_TABS) : next;
    }
    await this.reloadTab(id);
  }

  async reloadTab(id: string): Promise<void> {
    const generation = this.#generation;
    const target = this.tabs.find((tab) => tab.id === id);
    if (!target) return;
    target.loading = true;
    target.error = "";
    try {
      if (target.kind === "file") {
        // A reload always restarts at byte 0: the file may have been rewritten,
        // so appending to what is already loaded would splice two versions.
        const preview = await loadDesktopProjectFile(this.endpoint, this.projectId, target.path);
        if (generation !== this.#generation) return;
        const current = this.tabs.find((tab) => tab.id === id);
        if (!current) return;
        current.preview = preview;
        current.loadedBytes = preview.status === "text" ? preview.byteOffset + preview.byteLength : 0;
      } else {
        const diff = await loadDesktopProjectGitDiff(this.endpoint, this.projectId, target.path);
        if (generation !== this.#generation) return;
        const current = this.tabs.find((tab) => tab.id === id);
        if (!current) return;
        current.diff = diff;
      }
    } catch (cause) {
      if (generation !== this.#generation) return;
      const current = this.tabs.find((tab) => tab.id === id);
      if (current) current.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === this.#generation) {
        const current = this.tabs.find((tab) => tab.id === id);
        if (current) current.loading = false;
      }
    }
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.tabs = this.tabs.filter((tab) => tab.id !== id);
    if (this.activeTabId !== id) return;
    this.activeTabId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? "";
  }

  closeAllTabs(): void {
    this.tabs = [];
    this.activeTabId = "";
  }

  clearReveal(id: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (tab) tab.revealLine = 0;
  }

  /**
   * Appends the next byte window of a partially loaded text file. The server
   * decides where a window ends (it never splits a character), so the next
   * offset always comes from the previous response rather than being computed.
   */
  async loadMoreBytes(id: string): Promise<void> {
    const generation = this.#generation;
    const target = this.tabs.find((tab) => tab.id === id);
    if (!target || target.kind !== "file" || target.loadingMore) return;
    const current = target.preview;
    if (current?.status !== "text" || !current.truncated) return;
    const offset = current.byteOffset + current.byteLength;

    target.loadingMore = true;
    try {
      const next = await loadDesktopProjectFile(this.endpoint, this.projectId, target.path, { offset });
      if (generation !== this.#generation) return;
      const tab = this.tabs.find((candidate) => candidate.id === id);
      if (!tab || next.status !== "text") return;
      const shown = tab.preview;
      // The tab may have been reloaded underneath this request; only append when
      // the window on screen still ends exactly where this one begins.
      if (shown?.status !== "text" || shown.byteOffset + shown.byteLength !== offset) return;
      tab.preview = {
        ...next,
        content: shown.content + next.content,
        byteOffset: shown.byteOffset,
        byteLength: shown.byteLength + next.byteLength
      };
      tab.loadedBytes = next.byteOffset + next.byteLength;
    } catch (cause) {
      if (generation !== this.#generation) return;
      const tab = this.tabs.find((candidate) => candidate.id === id);
      if (tab) tab.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === this.#generation) {
        const tab = this.tabs.find((candidate) => candidate.id === id);
        if (tab) tab.loadingMore = false;
      }
    }
  }

  rawFileUrl(filePath: string): string {
    return desktopProjectRawFileUrl(this.endpoint, this.projectId, filePath);
  }

  async revealInFinder(filePath: string, mode: "reveal" | "open"): Promise<void> {
    if (!this.projectId) return;
    await revealDesktopProjectFile(this.endpoint, this.projectId, filePath, mode);
  }

  // ── Git ─────────────────────────────────────────────────────────────────

  async loadGit(): Promise<void> {
    if (!this.projectId) return;
    const generation = this.#generation;
    this.gitLoading = true;
    this.gitError = "";
    try {
      const status = await loadDesktopProjectGitStatus(this.endpoint, this.projectId);
      if (generation !== this.#generation) return;
      this.git = status;
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.gitError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === this.#generation) this.gitLoading = false;
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────

  setSearchQuery(value: string): void {
    this.searchQuery = value;
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    if (!value.trim()) {
      this.#searchAbort?.abort();
      this.searchResult = null;
      this.searchLoading = false;
      this.searchError = "";
      return;
    }
    this.searchLoading = true;
    this.#searchTimer = setTimeout(() => void this.runSearch(), this.searchMode === "content" ? 260 : 140);
  }

  setSearchMode(mode: SearchMode): void {
    if (this.searchMode === mode) return;
    this.searchMode = mode;
    this.searchResult = null;
    if (this.searchQuery.trim()) this.setSearchQuery(this.searchQuery);
  }

  async runSearch(): Promise<void> {
    const query = this.searchQuery.trim();
    if (!query || !this.projectId) return;
    this.#searchAbort?.abort();
    const abort = new AbortController();
    this.#searchAbort = abort;
    const searchGeneration = ++this.#searchGeneration;
    const generation = this.#generation;
    this.searchLoading = true;
    this.searchError = "";
    try {
      const result = await searchDesktopProjectFiles(
        this.endpoint,
        this.projectId,
        { query, mode: this.searchMode },
        abort.signal
      );
      if (searchGeneration !== this.#searchGeneration || generation !== this.#generation) return;
      this.searchResult = result;
    } catch (cause) {
      if (abort.signal.aborted) return;
      if (searchGeneration !== this.#searchGeneration || generation !== this.#generation) return;
      this.searchError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (searchGeneration === this.#searchGeneration) this.searchLoading = false;
    }
  }

  closeSearch(): void {
    this.searchOpen = false;
    this.#searchAbort?.abort();
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    this.searchLoading = false;
  }

  // ── Change stream ───────────────────────────────────────────────────────

  #restartWatch(): void {
    this.#watchAbort?.abort();
    this.watching = false;
    if (!this.projectId || !this.endpoint) return;
    const abort = new AbortController();
    this.#watchAbort = abort;
    const generation = this.#generation;
    void watchDesktopProjectFiles(
      this.endpoint,
      this.projectId,
      {
        onReady: () => {
          if (generation === this.#generation) this.watching = true;
        },
        onChange: (batch) => {
          if (generation === this.#generation) this.applyChanges(batch);
        },
        onUnavailable: () => {
          if (generation === this.#generation) this.watching = false;
        }
      },
      abort.signal
    ).catch(() => {
      // A missing or interrupted stream degrades to the manual refresh button.
      if (generation === this.#generation) this.watching = false;
    }).finally(() => {
      if (generation === this.#generation && this.#watchAbort === abort) this.watching = false;
    });
  }

  /**
   * Reconciles a watcher batch: reloads only the directory levels and open tabs
   * the change actually touched. An `overflow` batch (a checkout or an install)
   * reloads everything currently visible instead of enumerating paths.
   */
  applyChanges(batch: DesktopProjectChangeBatch): void {
    this.#scheduleGitRefresh();
    if (batch.overflow) {
      for (const path of Object.keys(this.dirs)) void this.loadDir(path, { force: true });
      for (const tab of this.tabs) void this.reloadTab(tab.id);
      return;
    }
    const dirtyDirs = new Set<string>();
    for (const path of batch.paths) dirtyDirs.add(parentDir(path));
    for (const path of dirtyDirs) {
      if (this.dirs[path]) void this.loadDir(path, { force: true });
    }
    const changed = new Set(batch.paths);
    for (const tab of this.tabs) {
      if (changed.has(tab.path)) void this.reloadTab(tab.id);
    }
  }

  #scheduleGitRefresh(): void {
    if (this.#gitRefreshTimer) clearTimeout(this.#gitRefreshTimer);
    this.#gitRefreshTimer = setTimeout(() => void this.loadGit(), 400);
  }

  /** Reloads every visible surface — the refresh button and the manual fallback. */
  refreshAll(): void {
    for (const path of Object.keys(this.dirs)) void this.loadDir(path, { force: true });
    for (const tab of this.tabs) void this.reloadTab(tab.id);
    void this.loadGit();
  }
}
