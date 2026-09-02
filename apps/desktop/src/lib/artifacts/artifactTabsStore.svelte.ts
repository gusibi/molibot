import {
  desktopFileContentUrl,
  desktopProjectRawFileUrl,
  fetchDesktopFileBlob,
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
import type { DesktopSessionFile } from "@molibot/desktop-contract";
import type { ArtifactScope, ArtifactTabKind } from "./viewerRegistry";
import { matchViewer, needsTextContent } from "./viewerRegistry";

/** One directory level of the tree, keyed in `dirs` by its Project-relative path ("" is the root). */
export interface TreeLevel {
  entries: DesktopProjectTreeEntry[];
  nextCursor: string;
  loading: boolean;
  error: string;
}

/**
 * One open Artifact Panel tab. File and diff tabs carry loaded content from the
 * Project inspection API; Mini App tabs carry only an appId (the iframe loads
 * itself). Session-scope file tabs (Slice 1b) additionally hold a blob URL the
 * container revokes on close.
 */
export interface ArtifactTab {
  id: string;
  kind: ArtifactTabKind;
  scope: ArtifactScope;
  /**
   * The artifact's path inside its own root: Project-relative for a project
   * tab, workspace-relative for a session attachment, empty for a Mini App.
   */
  path: string;
  /** Mini App id (miniapp) or empty (file/diff). */
  appId: string;
  /**
   * App-defined locator from a deep link, handed to the App UI as a startup
   * hint. Empty for a plain open and for every non-Mini-App tab.
   */
  deepLinkPath: string;
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
  /** Blob URL for a session-scope file tab; revoked on close (test seam #5). */
  blobUrl: string;
  /** Session-file identity (session scope only); empty for project/miniapp tabs. */
  fileId: string;
  mediaType: string;
  mimeType: string;
  size: number;
  /** Decoded text for session-scope code/csv tabs (project tabs use `preview`). */
  textContent: string;
  /** Timestamp/version to bust image and media preview caches when reloaded. */
  version: number;
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
 * `dirs` and `expanded` explicitly - a template helper that read them itself
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

function tabId(kind: ArtifactTabKind, key: string): string {
  return `${kind}:${key}`;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/**
 * Owns everything the Artifact Panel shows: the unified tab strip (file / diff /
 * Mini App) and, for Project scope, the lazily expanded tree, Git status, search
 * and the file-change subscription.
 *
 * Every async load carries a generation counter plus its owner key (directory
 * path / tab id) and re-validates before writing, so a slow response can never
 * overwrite what the user selected in the meantime.
 */
export class ArtifactTabsStore {
  endpoint = $state("");
  projectId = $state("");
  scope = $state<ArtifactScope>("project");
  /** Session-scope identity for fetching attachment blobs (empty in project scope). */
  profileId = $state("");
  sessionId = $state("");

  dirs = $state<Record<string, TreeLevel>>({});
  expanded = $state<Record<string, boolean>>({});
  /** Row the tree's roving focus sits on; drives arrow-key navigation. */
  cursorPath = $state("");

  tabs = $state<ArtifactTab[]>([]);

  /**
   * Which half of the panel is on screen. Files and Mini Apps are different
   * kinds of thing and no longer share a tab strip: one strip listing
   * `AGENTS.md` next to a running expense tracker made "go read a file" and
   * "leave my app" look like the same gesture.
   *
   * Each side keeps its own selection, so switching modes returns to whatever
   * was last open there instead of resetting.
   */
  mode = $state<"files" | "miniapps">("files");
  activeFileTabId = $state("");
  activeMiniAppTabId = $state("");

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

  /** File and diff tabs, in open order. */
  get fileTabs(): ArtifactTab[] {
    return this.tabs.filter((tab) => tab.kind !== "miniapp");
  }

  /** Mini App tabs, in open order. All stay mounted; only one is visible. */
  get miniAppTabs(): ArtifactTab[] {
    return this.tabs.filter((tab) => tab.kind === "miniapp");
  }

  /** The selected tab id for the mode currently on screen. */
  get activeTabId(): string {
    return this.mode === "miniapps" ? this.activeMiniAppTabId : this.activeFileTabId;
  }

  get activeTab(): ArtifactTab | null {
    return this.tabs.find((tab) => tab.id === this.activeTabId) ?? null;
  }

  /** The Mini App tab on screen, or null when the panel is showing files. */
  get activeMiniAppTab(): ArtifactTab | null {
    return this.tabs.find((tab) => tab.id === this.activeMiniAppTabId && tab.kind === "miniapp") ?? null;
  }

  /**
   * Selects a tab and switches to the mode that owns it.
   *
   * Takes the kind explicitly rather than looking it up: every `open*` method
   * activates the tab before appending it, so at that moment it is not in
   * `tabs` yet and a lookup would silently select nothing.
   */
  selectTab(id: string, kind: ArtifactTabKind): void {
    if (kind === "miniapp") {
      this.activeMiniAppTabId = id;
      this.mode = "miniapps";
    } else {
      this.activeFileTabId = id;
      this.mode = "files";
    }
  }

  /** Switches modes without changing either side's selection. */
  setMode(mode: "files" | "miniapps"): void {
    this.mode = mode;
  }

  /**
   * Points the store at a Project (or a non-Project session) and carries the
   * session fetch identity alongside, so Session-scope tabs can load their
   * bytes whichever surface is on screen.
   *
   * The reset fires when the SURFACE changes (endpoint, Project, or the
   * Session-conversation identity in Session scope, where the conversation is
   * the surface). Switching conversations inside one Project only invalidates
   * what belongs to the old conversation - its Session tabs - and keeps the
   * tree, Git state and Project tabs the surface exists to show.
   *
   * Mini App tabs deliberately SURVIVE: an app is a workspace of its own, not
   * an artifact of the conversation it was opened beside. Clearing them here is
   * what used to make switching sessions tear a running app down (its iframe is
   * destroyed with the tab) and drop the panel back to an empty file surface.
   */
  connect(endpoint: string, projectId: string, scope: ArtifactScope, profileId = "", sessionId = ""): void {
    const surfaceChanged =
      this.endpoint !== endpoint || this.projectId !== projectId || this.scope !== scope;
    const fetchIdentityChanged = this.profileId !== profileId || this.sessionId !== sessionId;
    // The fetch identity always follows the host: Session-tab URLs and blobs
    // are built from it, stale or not.
    this.profileId = profileId;
    this.sessionId = sessionId;
    // In Session scope the conversation IS the surface, so a conversation
    // switch resets it like any other. In Project scope the switch only orphans
    // the previous conversation's Session tabs.
    if (!surfaceChanged && !(scope === "session" && fetchIdentityChanged)) {
      if (fetchIdentityChanged) this.#dropSessionTabs();
      return;
    }
    this.#generation += 1;
    this.endpoint = endpoint;
    this.projectId = projectId;
    this.scope = scope;
    this.#revokeBlobUrls();
    // Mini App tabs are carried over; their `scope` follows the new context so
    // nothing downstream reads a stale one.
    const keptMiniApps = this.tabs
      .filter((tab) => tab.kind === "miniapp")
      .map((tab) => ({ ...tab, scope }));
    this.dirs = {};
    this.expanded = {};
    this.cursorPath = "";
    this.tabs = keptMiniApps;
    this.activeFileTabId = "";
    this.activeMiniAppTabId = keptMiniApps.some((tab) => tab.id === this.activeMiniAppTabId)
      ? this.activeMiniAppTabId
      : keptMiniApps[0]?.id ?? "";
    // Staying on the Mini App the user was looking at is the whole point of
    // keeping the tabs; only fall back to files when no app is open.
    this.mode = this.activeMiniAppTabId && this.mode === "miniapps" ? "miniapps" : "files";
    this.git = null;
    this.gitError = "";
    this.searchQuery = "";
    this.searchResult = null;
    this.searchError = "";
    this.searchOpen = false;
    this.#restartWatch();
    if (scope === "project" && projectId) {
      void this.loadDir("", { force: true });
      void this.loadGit();
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#revokeBlobUrls();
    this.#watchAbort?.abort();
    this.#watchAbort = null;
    this.#searchAbort?.abort();
    this.#searchAbort = null;
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    if (this.#gitRefreshTimer) clearTimeout(this.#gitRefreshTimer);
    this.watching = false;
  }

  #revokeBlobUrls(): void {
    for (const tab of this.tabs) {
      if (tab.blobUrl) URL.revokeObjectURL(tab.blobUrl);
      tab.blobUrl = "";
    }
  }

  /**
   * Closes every Session-scope file tab. They belong to one conversation: once
   * the panel's session identity moves on, their file ids no longer resolve and
   * the tabs would only render fetch errors. Project tabs and Mini Apps stay.
   */
  #dropSessionTabs(): void {
    const stale = new Set(
      this.tabs.filter((tab) => tab.kind !== "miniapp" && tab.scope === "session").map((tab) => tab.id)
    );
    if (!stale.size) return;
    for (const tab of this.tabs) {
      if (stale.has(tab.id) && tab.blobUrl) URL.revokeObjectURL(tab.blobUrl);
    }
    this.tabs = this.tabs.filter((tab) => !stale.has(tab.id));
    if (stale.has(this.activeFileTabId)) this.activeFileTabId = this.fileTabs[0]?.id ?? "";
  }

  /**
   * Commits a new tab list, capping each kind at `MAX_OPEN_TABS` independently.
   *
   * Per kind, not overall: the two sides are separate surfaces now, so browsing
   * a dozen files must not silently evict a running Mini App the user still has
   * open in the other mode.
   *
   * Eviction is a close: a tab that falls off the front owns a blob URL that
   * nothing else will ever release, so it must be revoked here. Every open path
   * goes through this one helper rather than slicing inline - three separate
   * `slice` calls is how one of them silently stopped releasing (test seam #5).
   */
  #commitTabs(next: ArtifactTab[]): void {
    const evicted: ArtifactTab[] = [];
    const keep = new Set<ArtifactTab>();
    for (const kind of ["file", "miniapp"] as const) {
      // File and diff tabs share one budget; Mini Apps have their own.
      const group = next.filter((tab) => (kind === "miniapp" ? tab.kind === "miniapp" : tab.kind !== "miniapp"));
      const overflow = group.length - MAX_OPEN_TABS;
      group.forEach((tab, index) => (index < overflow ? evicted.push(tab) : keep.add(tab)));
    }
    if (evicted.length === 0) {
      this.tabs = next;
      return;
    }
    for (const tab of evicted) {
      if (tab.blobUrl) URL.revokeObjectURL(tab.blobUrl);
    }
    // Rebuild from `next` so the surviving tabs keep their original open order.
    this.tabs = next.filter((tab) => keep.has(tab));
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
    await this.#openFileTab("file", path, options.revealLine ?? 0);
  }

  async openDiff(path: string): Promise<void> {
    await this.#openFileTab("diff", path, 0);
  }

  /**
   * Opens a Mini App tab. The iframe owns its own loading and state, so the store
   * only records the tab and activates it - no content fetch, no generation risk.
   * Re-opening an app that is already a tab just activates it.
   */
  openMiniApp(appId: string, deepLinkPath = ""): void {
    const id = tabId("miniapp", appId);
    const existing = this.tabs.find((tab) => tab.id === id);
    this.selectTab(id, "miniapp");
    if (existing) {
      // A deep link into an app that is already open must still navigate, so the
      // locator is updated in place; the panel keys its iframe on the resulting
      // URL and reloads. An ordinary re-open carries no path and must NOT clear
      // one the app is currently showing, or clicking the sidebar icon would
      // silently undo the link the owner just followed.
      if (deepLinkPath && existing.deepLinkPath !== deepLinkPath) {
        this.#commitTabs(this.tabs.map((tab) => (tab.id === id ? { ...tab, deepLinkPath } : tab)));
      }
      return;
    }
    const tab: ArtifactTab = {
      id, kind: "miniapp", scope: this.scope, path: "", appId, deepLinkPath,
      name: appId, loading: false, error: "", preview: null, diff: null,
      revealLine: 0, loadingMore: false, loadedBytes: 0, blobUrl: "",
      fileId: "", mediaType: "", mimeType: "", size: 0, textContent: "",
      version: Date.now()
    };
    this.#commitTabs([...this.tabs, tab]);
  }

  /**
   * Opens a chat session attachment as a session-scope file tab (PRD §3.38
   * Slice 1b). Media (image/audio/video/pdf) streams straight from the desktop
   * file route so video can seek; text (code/csv) and HTML are fetched as a blob
   * so the viewer gets decodable content or a renderable URL. The blob URL is
   * stored on the tab and revoked on close (test seam #5).
   */
  async openSessionFile(file: DesktopSessionFile): Promise<void> {
    const id = tabId("file", `session:${file.id}`);
    const existing = this.tabs.find((tab) => tab.id === id);
    this.selectTab(id, "file");
    if (existing) return;
    const tab: ArtifactTab = {
      // `path` is the artifact's location inside its own root in both scopes -
      // Project-relative there, workspace-relative here. One path string means
      // one thing everywhere it is read (pitfall #6 corollary).
      id, kind: "file", scope: "session", path: file.local ?? "", appId: "", deepLinkPath: "",
      name: file.original, loading: true, error: "", preview: null, diff: null,
      revealLine: 0, loadingMore: false, loadedBytes: 0, blobUrl: "",
      fileId: file.id, mediaType: file.mediaType, mimeType: file.mimeType ?? "",
      size: file.size, textContent: "",
      version: Date.now()
    };
    this.#commitTabs([...this.tabs, tab]);
    await this.#loadSessionFileTab(id, file);
  }

  /** Streaming URL for a session attachment (Range-supported, so video seeks). */
  sessionFileUrl(fileId: string, version?: number): string {
    return desktopFileContentUrl(this.endpoint, this.profileId, this.sessionId, fileId, false, this.projectId || undefined, version);
  }

  async #loadSessionFileTab(id: string, file: DesktopSessionFile): Promise<void> {
    const generation = this.#generation;
    const target = this.tabs.find((tab) => tab.id === id);
    if (!target) return;
    target.loading = true;
    target.error = "";
    try {
      const viewer = matchViewer({
        name: file.original,
        mimeType: file.mimeType,
        mediaType: file.mediaType,
        scope: "session"
      });
      // Media streams directly - no blob to manage or revoke. Which viewers need
      // decoded text is a registry fact (`needsTextContent`), not a list
      // maintained here: adding a viewer must not require editing the loader.
      if (viewer === "html" || needsTextContent(viewer)) {
        const blob = await fetchDesktopFileBlob(
          this.endpoint,
          this.profileId,
          this.sessionId,
          file.id,
          false,
          this.projectId || undefined
        );
        if (generation !== this.#generation) return;
        const current = this.tabs.find((tab) => tab.id === id);
        if (!current) return;
        if (viewer === "html") {
          current.blobUrl = URL.createObjectURL(blob);
        } else {
          // code/csv/markdown/json/svg: decode once; the viewer reads text.
          current.textContent = await blob.text();
        }
      }
      const current = this.tabs.find((tab) => tab.id === id);
      if (current) current.version = Date.now();
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

  async #openFileTab(kind: "file" | "diff", path: string, revealLine: number): Promise<void> {
    const id = tabId(kind, path);
    const existing = this.tabs.find((tab) => tab.id === id);
    this.selectTab(id, kind);
    if (existing) {
      existing.revealLine = revealLine;
      if (!existing.loading && !existing.error && (existing.preview || existing.diff)) {
        await this.reloadTab(id);
        return;
      }
    } else {
      const tab: ArtifactTab = {
        id, kind, scope: this.scope, path, appId: "", deepLinkPath: "", name: baseName(path),
        loading: true, error: "", preview: null, diff: null, revealLine,
        loadingMore: false, loadedBytes: 0, blobUrl: "",
        fileId: "", mediaType: "", mimeType: "", size: 0, textContent: "",
        version: Date.now()
      };
      // Drops the least-recently-opened tab, releasing whatever it held.
      this.#commitTabs([...this.tabs, tab]);
    }
    await this.reloadTab(id);
  }

  async reloadTab(id: string): Promise<void> {
    const generation = this.#generation;
    const target = this.tabs.find((tab) => tab.id === id);
    if (!target || target.kind === "miniapp") return;
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
        current.version = Date.now();
      } else {
        const diff = await loadDesktopProjectGitDiff(this.endpoint, this.projectId, target.path);
        if (generation !== this.#generation) return;
        const current = this.tabs.find((tab) => tab.id === id);
        if (!current) return;
        current.diff = diff;
        current.version = Date.now();
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

  /**
   * Closes one tab and, if it was the selected one, falls back within its own
   * kind. Closing the last file must not jump the panel into a Mini App, and
   * closing a Mini App must not drag it into the file tree.
   */
  closeTab(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const removed = this.tabs[index];
    const isMiniApp = removed.kind === "miniapp";
    const siblings = isMiniApp ? this.miniAppTabs : this.fileTabs;
    const siblingIndex = siblings.findIndex((tab) => tab.id === id);

    this.tabs.splice(index, 1);
    if (removed.blobUrl) URL.revokeObjectURL(removed.blobUrl);
    this.tabs = [...this.tabs];

    const remaining = isMiniApp ? this.miniAppTabs : this.fileTabs;
    const fallback = remaining[Math.min(siblingIndex, remaining.length - 1)]?.id ?? "";
    if (isMiniApp) {
      if (this.activeMiniAppTabId === id) this.activeMiniAppTabId = fallback;
      // Nothing left to show on this side: fall back to the file surface.
      if (remaining.length === 0) this.mode = "files";
    } else if (this.activeFileTabId === id) {
      this.activeFileTabId = fallback;
    }
  }

  /** Closes every tab in the mode currently on screen, leaving the other intact. */
  closeAllTabs(): void {
    const closing = this.mode === "miniapps" ? this.miniAppTabs : this.fileTabs;
    const closingIds = new Set(closing.map((tab) => tab.id));
    for (const tab of closing) {
      if (tab.blobUrl) URL.revokeObjectURL(tab.blobUrl);
    }
    this.tabs = this.tabs.filter((tab) => !closingIds.has(tab.id));
    if (this.mode === "miniapps") {
      this.activeMiniAppTabId = "";
      this.mode = "files";
    } else {
      this.activeFileTabId = "";
    }
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

  rawFileUrl(filePath: string, version?: number): string {
    return desktopProjectRawFileUrl(this.endpoint, this.projectId, filePath, version);
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
    if (!this.projectId || !this.endpoint || this.scope !== "project") return;
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
      for (const tab of this.tabs) if (tab.kind !== "miniapp") void this.reloadTab(tab.id);
      return;
    }
    const dirtyDirs = new Set<string>();
    for (const path of batch.paths) dirtyDirs.add(parentDir(path));
    for (const path of dirtyDirs) {
      if (this.dirs[path]) void this.loadDir(path, { force: true });
    }
    const changed = new Set(batch.paths);
    for (const tab of this.tabs) {
      if (tab.kind !== "miniapp" && changed.has(tab.path)) void this.reloadTab(tab.id);
    }
  }

  #scheduleGitRefresh(): void {
    if (this.#gitRefreshTimer) clearTimeout(this.#gitRefreshTimer);
    this.#gitRefreshTimer = setTimeout(() => void this.loadGit(), 400);
  }
}
