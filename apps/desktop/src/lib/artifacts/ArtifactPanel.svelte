<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import At from "reicon-svelte/icons/At";
  import BranchUp from "reicon-svelte/icons/BranchUp";
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import Check from "reicon-svelte/icons/Check";
  import Cloud from "reicon-svelte/icons/Cloud";
  import Code from "reicon-svelte/icons/Code";
  import CodeFile from "reicon-svelte/icons/CodeFile";
  import Compress from "reicon-svelte/icons/Compress";
  import Copy from "reicon-svelte/icons/Copy";
  import Crosshairs from "reicon-svelte/icons/Crosshairs";
  import Download from "reicon-svelte/icons/Download";
  import Expand from "reicon-svelte/icons/Expand";
  import Eye from "reicon-svelte/icons/Eye";
  import Folder from "reicon-svelte/icons/Folder";
  import FolderOpen from "reicon-svelte/icons/FolderOpen";
  import FileUp from "reicon-svelte/icons/FileUp";
  import Grid from "reicon-svelte/icons/Grid";
  import Home from "reicon-svelte/icons/Home";
  import Loader from "reicon-svelte/icons/Loader";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import Paperclip from "reicon-svelte/icons/Paperclip";
  import Refresh from "reicon-svelte/icons/Refresh";
  import RowVertical from "reicon-svelte/icons/RowVertical";
  import SquareArrowUp from "reicon-svelte/icons/SquareArrowUp";
  import X from "reicon-svelte/icons/X";
  import XCircle from "reicon-svelte/icons/XCircle";
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import { onDestroy, untrack } from "svelte";
  import type { Translation } from "../i18n";
  import { tablist } from "../a11y/tablist";
  import { rawPreviewKindFromName } from "@molibot/shared/filePreview";
  import { desktopFileContentUrl, fetchDesktopFileBlob, fetchDesktopProjectRawBlob, filterDesktopFiles, listDesktopSessionFiles, artifactPreviewUrl, sessionArtifactToken, revealDesktopSessionFile, type DesktopFileFilter } from "../api";
  import { saveBlobAsFile } from "../saveFile";
  import { html as renderDiffHtml } from "diff2html";
  import CodeViewer from "../projects/CodeViewer.svelte";
  import FileContextMenu from "../projects/FileContextMenu.svelte";
  import FileSearchPanel from "../projects/FileSearchPanel.svelte";
  import FileTreeNode from "../projects/FileTreeNode.svelte";
  import MediaViewer from "../projects/MediaViewer.svelte";
  import MiniAppPanel from "../miniapps/MiniAppPanel.svelte";
  import MiniAppIcon from "../miniapps/MiniAppIcon.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import { miniAppsStore } from "../stores/miniapps.svelte";
  import { pickProjectDirectory, projectsStore } from "../stores/projects.svelte";
  import { fileIconKind, fileIconStyle, formatSize } from "../projects/fileIcons";
  import { isProjectDirectoryAccessError, sameProjectDirectory } from "../projects/projectDirectoryAccess";
  import { FILE_KIND_ICONS } from "../projects/fileKindIcons";
  import type { FileMenuItem } from "../projects/fileMenu";
  import {
    requestComposerInsertion,
    requestMiniAppComposerAttachment,
    requestMiniAppComposerInsertion,
    requestMiniAppSessionOpen
  } from "../projects/composerBridge";
  import type { SessionFileTouches } from "../projects/sessionFileTouches";
  import { ArtifactTabsStore, flattenTree, type ArtifactTab } from "./artifactTabsStore.svelte";
  import { shouldOpenArtifactAsDiff } from "./artifactOpenMode";
  import { matchViewer, hasSourceToggle, type ArtifactScope } from "./viewerRegistry";
  import { resolveRelativeResourcePath } from "./markdownImages";
  import HtmlPreview from "./HtmlPreview.svelte";
  import CsvTable from "./CsvTable.svelte";
  import SpreadsheetTable from "./SpreadsheetTable.svelte";
  import DocxPreview from "./DocxPreview.svelte";
  import PptxPreview from "./PptxPreview.svelte";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import JsonTree from "./JsonTree.svelte";
  import SvgViewer from "./SvgViewer.svelte";
  import SystemOpenCard from "./SystemOpenCard.svelte";
  import TurnFileList from "../chat/TurnFileList.svelte";
  import { matchesSessionOutputPath, type TurnFileItem } from "../chat/turnFiles";

  /**
   * Artifact Panel - the single right-hand inspector surface.
   *
   * Files and Mini Apps are two surfaces sharing one panel, switched by the
   * head's segmented control (PRD §3.38 revision 2). They deliberately do NOT
   * share a tab strip: one strip listing `AGENTS.md` beside a running expense
   * tracker made "go read a file" and "leave my app" look like the same gesture,
   * and each side keeps its own selection so switching returns you to where you
   * were.
   *
   * The Mini App surface stays mounted whenever any app is open and is hidden
   * with CSS, never removed - `display: none` keeps an iframe's document alive,
   * an `{#if}` destroys it.
   *
   * File tabs dispatch their viewer through the shared registry (`matchViewer`)
   * so no per-format `if/else` lives in the template, and every file tab shares
   * one action bar (reveal / open-with-system / copy path / download, plus
   * insert-as-`@`-reference in Project scope).
   */
  let {
    endpoint,
    projectId,
    projectRootPath = "",
    sessionId,
    profileId = "",
    scope,
    touches,
    miniApp = "",
    miniAppNonce = 0,
    miniAppDeepLinkPath = "",
    sessionFile = null,
    sessionFileNonce = 0,
    openPath = "",
    openPathNonce = 0,
    openPathAsDiff = false,
    turnFiles = [],
    turnFilesNonce = 0,
    turnFileKey = "",
    locale,
    theme,
    copy,
    onClose
  }: {
    endpoint: string;
    projectId: string;
    /** Canonical Project root used to validate a native reauthorization pick. */
    projectRootPath?: string;
    sessionId: string;
    /** Web profile id for session-scope attachment fetches. */
    profileId?: string;
    scope: ArtifactScope;
    touches: SessionFileTouches;
    /** Mini App id to open on mount or on a live open request. */
    miniApp?: string;
    /** Bumped by the host to re-open `miniApp` even when the id is unchanged. */
    miniAppNonce?: number;
    /** App-defined locator when `miniApp` was opened from a deep link. */
    miniAppDeepLinkPath?: string;
    /** A chat attachment to open as a session-scope tab (Slice 1b). */
    sessionFile?: DesktopSessionFile | null;
    /** Bumped by the host so re-opening the same attachment re-activates its tab. */
    sessionFileNonce?: number;
    /**
     * Project-relative path to open as a tab, requested from outside the panel
     * (today: a file chip on a transcript's tool-activity list).
     */
    openPath?: string;
    /** Bumped by the host so re-requesting the same path re-activates its tab. */
    openPathNonce?: number;
    /** Open the path's diff rather than its contents — used for a written file. */
    openPathAsDiff?: boolean;
    /** Flat file results selected from one completed assistant turn. */
    turnFiles?: TurnFileItem[];
    turnFilesNonce?: number;
    turnFileKey?: string;
    locale: string;
    theme: "light" | "dark";
    copy: Translation;
    onClose: () => void;
  } = $props();

  const store = new ArtifactTabsStore();

  let tab = $state<"files" | "turn" | "changes" | "attachments">("files");
  let attachments = $state<DesktopSessionFile[]>([]);
  let attachmentsLoading = $state(false);
  let attachmentsError = $state("");
  let attachmentUrl = $state("");
  let attachmentPreview = $state<DesktopSessionFile | null>(null);
  let expandedAttachment = $state("");
  let copiedPath = $state("");
  let attachmentGeneration = 0;
  /** Media-type filter for the Session artifact list (the old right-hand aside). */
  let sessionFilter = $state<DesktopFileFilter>("all");

  /** Split position between the browser and the viewer, as a percentage of panel height. */
  const SPLIT_KEY = "molibot-desktop-file-split";
  const COLLAPSE_KEY = "molibot-desktop-file-browser-collapsed";
  const FOLLOW_KEY = "molibot-desktop-file-follow";
  let splitPercent = $state(clampSplit(Number(localStorage.getItem(SPLIT_KEY) || 0) || 52));
  let splitting = $state(false);
  let panelElement = $state<HTMLElement | null>(null);
  let browserElement = $state<HTMLElement | null>(null);

  /** Hides the browser so the viewer owns the whole panel - the panel is only ~380px wide. */
  let browserCollapsed = $state(localStorage.getItem(COLLAPSE_KEY) === "1");
  /** Opens the diff of whatever the agent just wrote, the way a pair would follow along. */
  let followAgentWrites = $state(localStorage.getItem(FOLLOW_KEY) !== "0");
  let lastFollowedPath = $state("");
  let followSession = $state("");

  let diffLayout = $state<"line-by-line" | "side-by-side">("line-by-line");
  /**
   * Markdown and SVG open rendered; this drops back to their source. Which
   * viewers offer the toggle is the registry's call (`hasSourceToggle`), not a
   * per-format condition in the template.
   */
  let showSource = $state(false);
  /** Bumps to reload the HtmlPreview iframe after the agent rewrites the file. */
  let htmlRefreshKey = $state(0);

  let menu = $state<{ x: number; y: number; path: string; kind: string; items: FileMenuItem[] } | null>(null);
  let actionError = $state("");
  let reauthorizingProject = $state(false);
  let appliedTurnFilesNonce = $state(0);

  /** Changes tab scope: everything Git reports, or only what this session wrote. */
  let changeScope = $state<"session" | "all">("session");

  const activeTab = $derived(store.activeTab);
  const treeRows = $derived(flattenTree(store.dirs, store.expanded));
  const gitEntries = $derived(store.git?.status === "ok" ? store.git.entries : []);
  const dirtyPaths = $derived(new Set(gitEntries.map((entry) => entry.path)));
  const sessionEntries = $derived(gitEntries.filter((entry) => touches.written.has(entry.path)));
  const visibleEntries = $derived(changeScope === "session" ? sessionEntries : gitEntries);
  const diffHtml = $derived(
    activeTab?.kind === "diff" && activeTab.diff?.status === "diff" && activeTab.diff.content
      ? renderDiffHtml(activeTab.diff.content, {
          drawFileList: false,
          outputFormat: diffLayout,
          matching: "lines",
          renderNothingWhenEmpty: false
        })
      : ""
  );

  /** Path segments of the open tab, each carrying the directory it points at. */
  const breadcrumb = $derived.by(() => {
    const segments = (activeTab?.path ?? "").split("/").filter(Boolean);
    let prefix = "";
    return segments.map((name, index) => {
      prefix = prefix ? `${prefix}/${name}` : name;
      return { name, path: prefix, isLast: index === segments.length - 1 };
    });
  });

  /** What the viewer can stream for the open tab when it is not decodable text. */
  const rawKind = $derived(activeTab ? rawPreviewKindFromName(activeTab.name) : "file");
  /** Project raw streaming URL; session tabs stream through `sessionStreamUrl` instead. */
  const rawUrl = $derived(
    activeTab && activeTab.scope === "project" ? store.rawFileUrl(activeTab.path, activeTab.version) : ""
  );
  /** Streaming URL for a session-scope attachment (Range-supported, so video seeks). */
  const sessionStreamUrl = $derived(
    activeTab?.scope === "session" && activeTab.fileId
      ? store.sessionFileUrl(activeTab.fileId, activeTab.version)
      : ""
  );
  /** Whichever stream serves the open tab; every media-grade viewer reads this. */
  const activeMediaSrc = $derived(activeTab?.scope === "project" ? rawUrl : sessionStreamUrl);
  /**
   * Registry dispatch for the active file tab; drives the viewer body. Tabs
   * carry a declared MIME and media type, so they are passed through - the
   * store's loader dispatches on exactly the same inputs, and the two must
   * never disagree about a tab.
   */
  const viewer = $derived(
    activeTab && activeTab.kind === "file"
      ? matchViewer({
          name: activeTab.name,
          mimeType: activeTab.mimeType,
          mediaType: activeTab.mediaType,
          scope: activeTab.scope
        })
      : null
  );
  /** Whether the current viewer offers a rendered/source toggle at all. */
  const sourceToggleAvailable = $derived(Boolean(viewer && hasSourceToggle(viewer)));
  /** Decoded text for the active tab, whichever scope loaded it. */
  const activeText = $derived(
    activeTab?.kind !== "file"
      ? ""
      : activeTab.scope === "project"
        ? activeTab.preview?.status === "text"
          ? activeTab.preview.content
          : ""
        : activeTab.textContent
  );
  /**
   * Iframe URL for the HTML preview, served through the artifact route in both
   * scopes.
   *
   * A blob URL has no path, so every relative `css/`, `img/` and `../assets/`
   * reference inside the page resolves to nothing - a multi-file page renders as
   * a bare skeleton. Routing Session previews through the same root-scoped
   * transport as Project previews is what makes those references work. Session
   * tabs fall back to their blob only when no route URL can be built (an
   * external read-only transcript, which the route declines to serve).
   */
  const htmlPreviewSrc = $derived.by(() => {
    if (viewer !== "html" || activeTab?.kind !== "file") return "";
    if (activeTab.scope === "project") {
      return projectId ? artifactPreviewUrl("project", projectId, activeTab.path, locale, theme) : "";
    }
    if (!sessionId || !activeTab.path) return "";
    const token = sessionArtifactToken({ profileId, sessionId, projectId: projectId || undefined });
    return artifactPreviewUrl("session", token, activeTab.path, locale, theme);
  });

  /**
   * Rewrites a markdown preview's relative image references to loadable URLs.
   *
   * A leaf-bundle `index.md` references its images by name
   * (`![alt](cloudflare-error-1102.png)`), but the preview renders in the
   * app's own document, where that relative src resolves against the app
   * origin and loads nothing. Resolving against the markdown file's own
   * directory and streaming the bytes through the file routes the panel
   * already uses — the raw Project route here, the artifact Session route (the
   * same transport the HTML preview rides) there — makes a moved-with-its-
   * images document render whole. References that are not relative (absolute
   * URLs, data URIs, paths escaping the root) pass through untouched.
   */
  const markdownImageResolver = $derived.by(() => {
    if (viewer !== "markdown" || activeTab?.kind !== "file" || !activeTab.path) return undefined;
    const baseDirectory = activeTab.path.includes("/")
      ? activeTab.path.slice(0, activeTab.path.lastIndexOf("/"))
      : "";
    if (activeTab.scope === "project") {
      if (!projectId) return undefined;
      return (href: string): string | null => {
        const resolved = resolveRelativeResourcePath(baseDirectory, href);
        return resolved ? store.rawFileUrl(resolved, activeTab.version) : null;
      };
    }
    if (!sessionId) return undefined;
    const token = sessionArtifactToken({ profileId, sessionId, projectId: projectId || undefined });
    return (href: string): string | null => {
      const resolved = resolveRelativeResourcePath(baseDirectory, href);
      return resolved ? artifactPreviewUrl("session", token, resolved, locale, theme) : null;
    };
  });

  /** Loads binary document bytes through the authorized desktop transport. */
  async function loadActiveBinaryBytes(): Promise<Blob> {
    const tab = store.activeTab;
    if (!tab || tab.kind !== "file") throw new Error("No binary document is selected.");
    if (tab.scope === "project") {
      return await fetchDesktopProjectRawBlob(endpoint, projectId, tab.path, tab.version);
    }
    if (!tab.fileId) throw new Error("The binary attachment is unavailable.");
    return await fetchDesktopFileBlob(endpoint, profileId || "personal", sessionId, tab.fileId, false, projectId || undefined);
  }
  /**
   * The Session artifact list - every file this conversation produced or
   * received. It is the Files surface in Session scope, where there is no
   * Project tree: without it, opening a Mini App beside a conversation left the
   * Files side of the panel showing nothing at all.
   */
  const panelTitle = $derived(scope === "project" ? copy.projectFilesPanel : copy.files);
  const filteredAttachments = $derived(filterDesktopFiles(attachments, sessionFilter));
  const attachmentsTotalSize = $derived(attachments.reduce((sum, file) => sum + file.size, 0));
  const sessionFilters: [DesktopFileFilter, string][] = $derived([
    ["all", copy.fileFilterAll],
    ["image", copy.fileFilterImage],
    ["video", copy.fileFilterVideo],
    ["audio", copy.fileFilterAudio],
    ["file", copy.fileFilterFile]
  ]);
  /** True while the panel is showing its Mini App surface rather than files. */
  const miniAppActive = $derived(store.mode === "miniapps");
  const miniAppTabs = $derived(store.miniAppTabs);
  const fileTabs = $derived(store.fileTabs);
  /** Mini App catalog entry for the visible app's head. */
  const miniAppEntry = $derived(
    store.activeMiniAppTab
      ? miniAppsStore.items.find((item) => item.id === store.activeMiniAppTab!.appId) ?? null
      : null
  );

  /** Catalog entry for any Mini App tab, for its own tab label and icon. */
  function miniAppInfo(appId: string) {
    return miniAppsStore.items.find((item) => item.id === appId) ?? null;
  }

  function clampSplit(value: number): number {
    return Math.min(80, Math.max(20, Math.round(value)));
  }

  function toggleBrowser(): void {
    browserCollapsed = !browserCollapsed;
    localStorage.setItem(COLLAPSE_KEY, browserCollapsed ? "1" : "0");
  }

  function toggleFollow(): void {
    followAgentWrites = !followAgentWrites;
    localStorage.setItem(FOLLOW_KEY, followAgentWrites ? "1" : "0");
  }

  function statusType(entry: { indexStatus: string; worktreeStatus: string; untracked: boolean }): string {
    if (entry.untracked) return "untracked";
    if (entry.indexStatus === "D" || entry.worktreeStatus === "D") return "deleted";
    if (entry.indexStatus === "A") return "added";
    if (entry.indexStatus === "R") return "renamed";
    return "modified";
  }

  function statusLabel(entry: { indexStatus: string; worktreeStatus: string; untracked: boolean }): string {
    const labels: Record<string, string> = {
      untracked: copy.projectFileUntracked,
      deleted: copy.projectFileDeleted,
      added: copy.projectFileAdded,
      renamed: copy.projectFileRenamed,
      modified: copy.projectFileModified
    };
    return labels[statusType(entry)];
  }

  function changeStatsLabel(entry: { additions: number | null; deletions: number | null; binary: boolean }): string {
    if (entry.binary) return copy.projectDiffBinary;
    const additions = entry.additions === null ? "—" : `+${entry.additions}`;
    const deletions = entry.deletions === null ? "—" : `−${entry.deletions}`;
    return `${additions} ${deletions}`;
  }

  function mentionInChat(path: string, line = 0): void {
    requestComposerInsertion(path, line);
  }

  async function revealInFinder(path: string, mode: "reveal" | "open"): Promise<void> {
    actionError = "";
    try {
      await store.revealInFinder(path, mode);
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  /**
   * Session peer of `revealInFinder`. A chat attachment lives in the Session
   * workspace, not a Project root, so it goes through the Session route; the
   * absolute path is resolved service-side and never reaches this component.
   */
  async function revealSessionFile(path: string, mode: "reveal" | "open"): Promise<void> {
    actionError = "";
    if (!path || !sessionId) return;
    try {
      await revealDesktopSessionFile(
        endpoint,
        { profileId, sessionId, projectId: projectId || undefined, path },
        mode
      );
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function downloadProjectFile(path: string): Promise<void> {
    actionError = "";
    try {
      const blob = await fetchDesktopProjectRawBlob(endpoint, projectId, path);
      await saveBlobAsFile(blob, path.split("/").pop() || path);
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  /** Downloads a session attachment through the same authorized route that fetched it. */
  async function downloadSessionFile(tab: ArtifactTab): Promise<void> {
    if (!tab.fileId) return;
    actionError = "";
    try {
      const blob = await fetchDesktopFileBlob(endpoint, profileId, sessionId, tab.fileId, true, projectId || undefined);
      await saveBlobAsFile(blob, tab.name);
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function contextMenuItems(path: string, kind: string): FileMenuItem[] {
    const isDirectory = kind === "directory";
    return [
      isDirectory
        ? { id: "toggle", label: store.expanded[path] ? copy.projectCollapseFolder : copy.projectExpandFolder, icon: CaretRight }
        : { id: "open", label: copy.projectOpenFile, icon: FileUp },
      { id: "diff", label: copy.projectViewDiff, icon: CodeFile, disabled: isDirectory || !dirtyPaths.has(path) },
      { id: "mention", label: copy.projectMentionInChat, icon: At, startsGroup: true },
      { id: "copy", label: copy.projectCopyPath, icon: Copy },
      // Joining onto the root needs the canonical root the host passes for
      // reauthorization; without it the item has nothing truthful to copy.
      { id: "copyAbs", label: copy.projectCopyAbsolutePath, icon: Copy, disabled: !projectRootPath },
      { id: "reveal", label: copy.projectRevealInFinder, icon: FolderOpen, startsGroup: true },
      { id: "external", label: copy.projectOpenExternally, icon: SquareArrowUp }
    ];
  }

  function openContextMenu(event: MouseEvent, path: string, kind: string): void {
    event.preventDefault();
    event.stopPropagation();
    menu = { x: event.clientX, y: event.clientY, path, kind, items: contextMenuItems(path, kind) };
  }

  /** Keyboard route to the same menu (Shift+F10 / ContextMenu key on the focused row). */
  function openContextMenuForKeyboard(event: KeyboardEvent, path: string, kind: string): void {
    if (!((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, path, kind, items: contextMenuItems(path, kind) };
  }

  function runMenuAction(id: string): void {
    const target = menu;
    if (!target) return;
    if (id === "toggle") store.toggleDir(target.path);
    else if (id === "open") void store.openFile(target.path);
    else if (id === "diff") void store.openDiff(target.path);
    else if (id === "mention") mentionInChat(target.path);
    else if (id === "copy") void copyPath(target.path);
    else if (id === "copyAbs") {
      const root = projectRootPath.replace(/\/+$/, "");
      if (root) void copyPath(`${root}/${target.path.replace(/^\/+/, "")}`);
    }
    else if (id === "reveal") void revealInFinder(target.path, "reveal");
    else if (id === "external") void revealInFinder(target.path, "open");
  }

  function focusTreeRow(path: string): void {
    store.cursorPath = path;
    queueMicrotask(() => {
      const row = browserElement?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"] .file-tree-button`);
      row?.focus();
      row?.scrollIntoView({ block: "nearest" });
    });
  }

  /** Finder/VS Code arrow-key semantics: ← collapses or climbs, -> expands or descends. */
  function onTreeKeydown(event: KeyboardEvent): void {
    if (!treeRows.length) return;
    const index = treeRows.findIndex((row) => row.path === store.cursorPath);
    const current = index >= 0 ? treeRows[index] : null;

    // ⌘↓ opens with the default app, so it has to be checked before plain ↓ moves the cursor.
    if ((event.metaKey || event.ctrlKey) && event.key === "ArrowDown") {
      if (!current) return;
      event.preventDefault();
      void revealInFinder(current.path, "open");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = index < 0 ? (delta > 0 ? 0 : treeRows.length - 1) : Math.min(treeRows.length - 1, Math.max(0, index + delta));
      focusTreeRow(treeRows[next].path);
      return;
    }
    if (!current) return;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (current.kind !== "directory") return;
      if (!current.expanded) store.toggleDir(current.path);
      else if (index + 1 < treeRows.length && treeRows[index + 1].depth > current.depth) focusTreeRow(treeRows[index + 1].path);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (current.kind === "directory" && current.expanded) {
        store.toggleDir(current.path);
        return;
      }
      for (let scan = index - 1; scan >= 0; scan -= 1) {
        if (treeRows[scan].depth < current.depth) {
          focusTreeRow(treeRows[scan].path);
          return;
        }
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (current.kind === "directory") store.toggleDir(current.path);
      else if (current.kind === "file") void store.openFile(current.path);
    }
  }

  async function copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      copiedPath = path;
      setTimeout(() => { if (copiedPath === path) copiedPath = ""; }, 1200);
    } catch { /* clipboard unavailable */ }
  }

  async function loadAttachments(): Promise<DesktopSessionFile[]> {
    const current = ++attachmentGeneration;
    const request = { endpoint, profileId, sessionId, projectId };
    const isCurrentRequest = () => endpoint === request.endpoint
      && profileId === request.profileId
      && sessionId === request.sessionId
      && projectId === request.projectId;
    attachmentsLoading = true;
    attachmentsError = "";
    try {
      // A Project session belongs to the built-in personal profile; a plain
      // conversation belongs to whichever bot owns it, so the host's profile id
      // wins when it has one. Reading the wrong profile returns an empty list
      // with no error, which is indistinguishable from "no files".
      const files = request.sessionId
        ? await listDesktopSessionFiles(request.endpoint, request.profileId || "personal", request.sessionId, request.projectId)
        : [];
      const stillCurrent = isCurrentRequest();
      if (current === attachmentGeneration && stillCurrent) attachments = files;
      return stillCurrent ? files : [];
    } catch (cause) {
      const stillCurrent = isCurrentRequest();
      if (current === attachmentGeneration && stillCurrent) attachmentsError = cause instanceof Error ? cause.message : String(cause);
      return [];
    } finally {
      if (current === attachmentGeneration && isCurrentRequest()) attachmentsLoading = false;
    }
  }

  async function reauthorizeProjectDirectory(): Promise<void> {
    if (!projectRootPath || reauthorizingProject) return;
    actionError = "";
    reauthorizingProject = true;
    try {
      const selected = await pickProjectDirectory();
      if (!selected) {
        if (projectsStore.error) actionError = projectsStore.error;
        return;
      }
      if (!sameProjectDirectory(selected, projectRootPath)) {
        actionError = copy.projectDirectoryWrongSelection.replace("{path}", projectRootPath);
        return;
      }
      await Promise.all([store.loadDir("", { force: true }), store.loadGit()]);
      if (isProjectDirectoryAccessError(store.dirs[""]?.error)) {
        actionError = copy.projectDirectoryAccessStillDenied;
      }
    } finally {
      reauthorizingProject = false;
    }
  }

  async function openTurnFile(file: TurnFileItem): Promise<void> {
    actionError = "";
    store.setMode("files");
    if (file.source === "project") {
      await store.openFile(file.path);
      return;
    }

    let sessionFile = attachments.find((candidate) =>
      (file.fileId && candidate.id === file.fileId) || matchesSessionOutputPath(candidate.local, file.path)
    );
    if (!sessionFile) {
      const refreshed = await loadAttachments();
      sessionFile = refreshed.find((candidate) =>
        (file.fileId && candidate.id === file.fileId) || matchesSessionOutputPath(candidate.local, file.path)
      );
    }
    if (!sessionFile) {
      actionError = copy.turnFileUnavailable;
      return;
    }
    await store.openSessionFile(sessionFile);
  }

  function selectTurnFile(file: TurnFileItem): void {
    void openTurnFile(file);
  }

  function closeAttachmentPreview(): void {
    attachmentUrl = "";
    attachmentPreview = null;
    expandedAttachment = "";
  }

  /**
   * Points the media element straight at the streaming endpoint. Buffering the
   * whole file into a Blob first put a large video entirely on the heap and left
   * the player unable to seek, because a Blob URL carries no Range support.
   */
  function openAttachment(file: DesktopSessionFile): void {
    if (expandedAttachment === file.id) { closeAttachmentPreview(); return; }
    expandedAttachment = file.id;
    attachmentUrl = desktopFileContentUrl(endpoint, "personal", sessionId, file.id, false, projectId, Date.now());
    attachmentPreview = file;
  }

  async function downloadAttachment(file: DesktopSessionFile): Promise<void> {
    try {
      const blob = await fetchDesktopFileBlob(endpoint, profileId || "personal", sessionId, file.id, true, projectId);
      await saveBlobAsFile(blob, file.original);
    } catch (cause) {
      attachmentsError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function startSplit(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    splitting = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveSplit(event: PointerEvent): void {
    if (!splitting || !panelElement) return;
    const bounds = panelElement.getBoundingClientRect();
    splitPercent = clampSplit(((event.clientY - bounds.top) / bounds.height) * 100);
  }

  function stopSplit(event: PointerEvent): void {
    if (!splitting) return;
    splitting = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    localStorage.setItem(SPLIT_KEY, String(splitPercent));
  }

  function onSplitKeydown(event: KeyboardEvent): void {
    const delta = event.key === "ArrowUp" ? -4 : event.key === "ArrowDown" ? 4 : 0;
    if (!delta) return;
    event.preventDefault();
    splitPercent = clampSplit(splitPercent + delta);
    localStorage.setItem(SPLIT_KEY, String(splitPercent));
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      store.searchOpen = true;
      store.setSearchMode("name");
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      store.searchOpen = true;
      store.setSearchMode("content");
    }
  }

  /**
   * Closing a tab falls back to the surface behind it - the Project tree, or
   * the Session artifact list - so the panel never closes itself out from under
   * a Mini App the user still has open in the other mode.
   */
  function handleCloseTab(id: string): void {
    store.closeTab(id);
  }

  /**
   * The store carries both identities at once: the surface (Project or plain
   * session) it renders, and the conversation's session identity its
   * Session-scope tabs fetch through. Gating the session identity on the scope
   * is what used to make a Session-scope tab unopenable inside a Project.
   */
  $effect(() => {
    const nextEndpoint = endpoint;
    const nextProjectId = projectId;
    const nextScope = scope;
    const nextProfileId = profileId;
    const nextSessionId = sessionId;
    untrack(() => store.connect(nextEndpoint, nextProjectId, nextScope, nextProfileId, nextSessionId));
  });

  // A live "open Mini App" request from the host: open it as a tab. The nonce
  // bumps even when the id repeats so a second click on an already-open app
  // re-activates its tab. Runs after `connect` so the tab lands in the right scope.
  $effect(() => {
    const nonce = miniAppNonce;
    const appId = miniApp;
    const deepLinkPath = miniAppDeepLinkPath;
    if (!appId) return;
    untrack(() => {
      nonce;
      store.openMiniApp(appId, deepLinkPath);
    });
  });

  // A live "open this path" request from a surface outside the panel. Mirrors
  // the Mini App effect above rather than inventing a second mechanism: the
  // nonce is what makes a repeat request for the same path re-activate its tab.
  $effect(() => {
    const nonce = openPathNonce;
    const path = openPath;
    const asDiff = openPathAsDiff;
    if (!path || scope !== "project") return;
    untrack(() => {
      nonce;
      store.setMode("files");
      void (asDiff ? store.openDiff(path) : store.openFile(path));
      void store.revealPath(path);
      store.cursorPath = path;
    });
  });

  // A live "open chat attachment" request: open it as a session-scope tab.
  $effect(() => {
    const nonce = sessionFileNonce;
    const file = sessionFile;
    if (!file) return;
    untrack(() => {
      nonce;
      void store.openSessionFile(file);
    });
  });

  // Markdown and SVG always open rendered; the source toggle is per file, not
  // sticky across tabs.
  $effect(() => {
    store.activeTabId;
    untrack(() => { showSource = false; });
  });

  // Follow-the-agent for HTML: when the watcher reloads the active HTML tab's
  // preview (the agent rewrote the file), reload the iframe so the user sees the
  // new version without clicking. `preview` is reassigned on every reload.
  $effect(() => {
    const preview = activeTab?.preview;
    if (viewer === "html" && preview) {
      untrack(() => { htmlRefreshKey += 1; });
    }
  });

  $effect(() => {
    const nonce = turnFilesNonce;
    const selected = turnFiles.find((file) => file.key === turnFileKey);
    untrack(() => {
      if (!nonce || nonce === appliedTurnFilesNonce || !turnFiles.length) return;
      appliedTurnFilesNonce = nonce;
      store.setMode("files");
      tab = "turn";
      if (selected) void openTurnFile(selected);
    });
  });

  // A context transplant (the host resetting file requests on a conversation
  // switch) empties the turn-file list; a "turn" tab pointing at nothing would
  // render a blank panel body, so fall back to the file tree.
  $effect(() => {
    const empty = turnFiles.length === 0;
    untrack(() => {
      if (empty && tab === "turn") tab = "files";
    });
  });

  $effect(() => {
    const identity = `${endpoint}:${projectId}:${profileId}:${sessionId}`;
    untrack(() => {
      identity;
      closeAttachmentPreview();
      void loadAttachments();
    });
  });

  // Follow the agent: when it writes a new file, surface that file's diff and
  // point the tree at it, so the panel keeps up with the run without clicking.
  // Opening a session adopts its existing history silently - only writes that
  // land while the session is on screen pull the viewer along.
  $effect(() => {
    const key = `${projectId}:${sessionId}`;
    const written = [...touches.written];
    const latest = written[written.length - 1] ?? "";
    const shouldFollow = followAgentWrites;
    untrack(() => {
      if (followSession !== key) {
        followSession = key;
        lastFollowedPath = latest;
        return;
      }
      if (!shouldFollow || !latest || latest === lastFollowedPath) return;
      lastFollowedPath = latest;
      shouldOpenArtifactAsDiff(latest, true)
        ? void store.openDiff(latest)
        : void store.openFile(latest);
      void store.revealPath(latest);
      store.cursorPath = latest;
    });
  });

  onDestroy(() => {
    store.dispose();
    closeAttachmentPreview();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  class="file-panel project-file-panel artifact-panel"
  class:miniapp-active={miniAppActive}
  class:splitting
  aria-label={panelTitle}
  bind:this={panelElement}
  style={`--file-split:${splitPercent}%`}
  onkeydown={onPanelKeydown}
>
  <!--
    One head for both surfaces. The Files/Mini Apps switch lives here rather
    than on a row of its own: the panel is ~380px wide and vertical space is the
    scarce axis, so a third full-width row pushed the actual content down while
    repeating the app name the tab strip already shows.

    With no Mini App open there is nothing to switch between, so the head keeps
    its plain title.
  -->
  <div class="file-panel-head">
    {#if miniAppTabs.length}
      <!--
        A menu, not a segmented control: switching surfaces is rare next to the
        reading you do inside one, so the affordance should name what you are
        looking at and stay out of the way. It reuses OverflowMenu, which
        already owns dismiss / Escape / arrow-key behaviour.
      -->
      <OverflowMenu variant="inline" label={copy.artifactModeSwitch}>
        <span class="artifact-mode-trigger" slot="trigger">
          {#if miniAppActive}<Grid size={16} aria-hidden="true" />{:else}<Folder size={16} aria-hidden="true" />{/if}
          <strong class="artifact-mode-current">{miniAppActive ? copy.artifactModeMiniApps : copy.artifactModeFiles}</strong>
          <AngleDown class="artifact-mode-caret" size={12} aria-hidden="true" />
        </span>
        <button role="menuitem" type="button" aria-current={!miniAppActive} onclick={() => store.setMode("files")}>
          <Folder size={16} aria-hidden="true" />
          <span>{copy.artifactModeFiles}</span>
          {#if !miniAppActive}<Check class="artifact-mode-tick" size={12} aria-hidden="true" />{/if}
        </button>
        <button role="menuitem" type="button" aria-current={miniAppActive} onclick={() => store.setMode("miniapps")}>
          <Grid size={16} aria-hidden="true" />
          <span>{copy.artifactModeMiniApps}</span>
          <span class="artifact-mode-count">{miniAppTabs.length}</span>
          {#if miniAppActive}<Check class="artifact-mode-tick" size={12} aria-hidden="true" />{/if}
        </button>
      </OverflowMenu>
    {:else}
      <Folder class="file-panel-icon" size={16} aria-hidden="true" />
      <strong>{panelTitle}</strong>
    {/if}

    {#if !miniAppActive}
      <!-- Search and follow-the-agent read the Project tree and its Git status,
           so they exist only in Project scope. The tree and its Git badges are
           live-watched (the footer states it), so there is no refresh button:
           the tree keeps itself current. -->
      {#if scope === "project"}
        <button
          type="button"
          class="project-panel-refresh"
          class:active={store.searchOpen}
          aria-label={copy.projectSearch}
          title={`${copy.projectSearch} (⌘P)`}
          onclick={() => (store.searchOpen ? store.closeSearch() : (store.searchOpen = true))}
        >
          <Magnifier size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="project-panel-refresh"
          class:active={followAgentWrites}
          aria-pressed={followAgentWrites}
          aria-label={copy.projectFollowAgent}
          title={followAgentWrites ? copy.projectFollowAgentOn : copy.projectFollowAgent}
          onclick={toggleFollow}
        >
          <Crosshairs size={16} aria-hidden="true" />
        </button>
      {/if}
    {/if}
    <button type="button" class="file-panel-close" aria-label={copy.closePanel} title={copy.closePanel} onclick={onClose}>
      <X size={14} aria-hidden="true" />
    </button>
  </div>

  {#if scope === "project" && store.searchOpen && !miniAppActive}
    <FileSearchPanel {store} {copy} />
  {:else}
    {#if !miniAppActive}
      <div class="project-file-tabs" role="tablist" aria-label={copy.projectFilesPanel} use:tablist>
        {#if scope === "project"}
          <button type="button" role="tab" id="project-file-tab-files" aria-selected={tab === "files"} aria-controls="project-file-panel" class:active={tab === "files"} onclick={() => (tab = "files")}>{copy.projectFilesTab}</button>
          {#if turnFiles.length}<button type="button" role="tab" id="project-file-tab-turn" aria-selected={tab === "turn"} aria-controls="project-file-panel" class:active={tab === "turn"} onclick={() => (tab = "turn")}>{copy.turnFilesTitle}<span class="project-tab-badge is-session">{turnFiles.length}</span></button>{/if}
          <button type="button" role="tab" id="project-file-tab-changes" aria-selected={tab === "changes"} aria-controls="project-file-panel" class:active={tab === "changes"} onclick={() => (tab = "changes")}>
            {copy.projectChangesTab}
            {#if sessionEntries.length}
              <span class="project-tab-badge is-session">{sessionEntries.length}</span>
            {:else if dirtyPaths.size}
              <span class="project-tab-badge">{dirtyPaths.size}</span>
            {/if}
          </button>
          <button type="button" role="tab" id="project-file-tab-attachments" aria-selected={tab === "attachments"} aria-controls="project-file-panel" class:active={tab === "attachments"} onclick={() => (tab = "attachments")}>{copy.projectAttachmentsTab}</button>
        {:else}
          {#if turnFiles.length}<button type="button" role="tab" id="project-file-tab-turn" aria-selected={tab === "turn"} aria-controls="project-file-panel" class:active={tab === "turn"} onclick={() => (tab = "turn")}>{copy.turnFilesTitle}<span class="project-tab-badge is-session">{turnFiles.length}</span></button>{/if}
          <button type="button" role="tab" id="project-file-tab-files" aria-selected={tab === "files"} aria-controls="project-file-panel" class:active={tab === "files"} onclick={() => (tab = "files")}>{copy.files}</button>
        {/if}
      </div>
    {/if}

    <div id="project-file-panel" class="project-panel-body" role="tabpanel" aria-labelledby={`project-file-tab-${tab}`} class:browser-collapsed={(browserCollapsed && fileTabs.length) || miniAppActive}>
      {#if actionError}
        <div class="project-panel-error" role="alert">{actionError}</div>
      {/if}

      <!--
        The Mini App surface stays mounted whenever any app is open, and is
        hidden with CSS rather than removed. `display: none` keeps an iframe's
        document alive; an `{#if}` destroys it, which is what used to reload
        every app the moment the user clicked a file (the app came back to its
        start screen with any in-progress input gone).
      -->
      {#if miniAppTabs.length}
        <section
          class="project-viewer artifact-miniapp-viewer"
          class:is-hidden={!miniAppActive}
          aria-hidden={!miniAppActive}
          aria-label={miniAppEntry?.name ?? store.activeMiniAppTab?.appId ?? ""}
        >
          <div class="project-viewer-tabs" role="tablist" aria-label={copy.artifactModeMiniApps} use:tablist>
            {#each miniAppTabs as appTab (appTab.id)}
              {@const info = miniAppInfo(appTab.appId)}
              <div class="project-viewer-tab" class:active={appTab.id === store.activeMiniAppTabId}>
                <button
                  type="button"
                  role="tab"
                  id={`miniapp-tab-${appTab.id}`}
                  aria-selected={appTab.id === store.activeMiniAppTabId}
                  aria-controls="miniapp-viewer-panel"
                  title={info?.name ?? appTab.appId}
                  onclick={() => store.selectTab(appTab.id, "miniapp")}
                >
                  {#if info?.iconDataUri}
                    <MiniAppIcon src={info.iconDataUri} label={info.name} size="tab" />
                  {:else}
                    <Grid size={16} aria-hidden="true" />
                  {/if}
                  <span>{info?.name ?? appTab.appId}</span>
                </button>
                <button type="button" class="project-viewer-tab-close" aria-label={copy.closeTab} title={copy.closeTab} onclick={() => handleCloseTab(appTab.id)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            {/each}
          </div>
          <div id="miniapp-viewer-panel" class="project-viewer-body miniapp-viewer-body" role="tabpanel" aria-labelledby={store.activeMiniAppTabId ? `miniapp-tab-${store.activeMiniAppTabId}` : undefined}>
            {#each miniAppTabs as appTab (appTab.id)}
              <div class="artifact-miniapp-slot" class:is-hidden={appTab.id !== store.activeMiniAppTabId}>
                <MiniAppPanel
                  appId={appTab.appId}
                  {locale}
                  {theme}
                  {copy}
                  deepLinkPath={appTab.deepLinkPath}
                  onComposerInsert={(text, mode) => requestMiniAppComposerInsertion(text, mode, scope)}
                  onComposerAttach={(path, name) => requestMiniAppComposerAttachment(appTab.appId, path, name, scope)}
                  onOpenSession={(sessionId) => requestMiniAppSessionOpen(sessionId, scope)}
                />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <div class="artifact-file-surface" class:is-hidden={miniAppActive}>
      {#if scope === "project"}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="project-browser"
          bind:this={browserElement}
          aria-busy={store.dirs[""]?.loading || store.gitLoading}
          onkeydown={(event) => { if (tab === "files") onTreeKeydown(event); }}
          role={tab === "files" ? "tree" : "group"}
          aria-label={copy.projectFilesTab}
          tabindex="-1"
        >
          {#if tab === "turn"}
            <TurnFileList files={turnFiles} {copy} onOpen={selectTurnFile} />
          {:else if tab === "files"}
            <div class="project-browser-actions">
              <button type="button" onclick={() => store.collapseAllDirs()}>
                <Compress size={16} aria-hidden="true" />{copy.projectCollapseAll}
              </button>
            </div>
            {#if isProjectDirectoryAccessError(store.dirs[""]?.error)}
              <div class="project-panel-error project-directory-access-error" role="alert">
                <span>{copy.projectDirectoryAccessDenied}</span>
                <button class="secondary-button" type="button" disabled={reauthorizingProject} onclick={() => void reauthorizeProjectDirectory()}>
                  {reauthorizingProject ? copy.loading : copy.projectReauthorizeDirectory}
                </button>
              </div>
            {:else if store.dirs[""]?.error}
              <div class="project-panel-error" role="alert">{store.dirs[""].error}</div>
            {/if}
            <FileTreeNode
              {store}
              dirPath=""
              {copy}
              {dirtyPaths}
              touchedPaths={touches.written}
              onCopyPath={(path) => void copyPath(path)}
              onMention={(path) => mentionInChat(path)}
              onContextMenu={openContextMenu}
              {copiedPath}
            />
          {:else if tab === "changes"}
            {#if store.gitError}
              <div class="project-panel-error" role="alert">{store.gitError}</div>
            {:else if store.git?.status === "unavailable"}
              <p class="file-empty"><BranchUp size={20} aria-hidden="true" /><span>{copy.projectGitUnavailable}</span><small>{store.git.reason}</small></p>
            {:else if gitEntries.length}
              <div class="project-change-scope" role="tablist" aria-label={copy.projectChangesTab} use:tablist>
                <button
                  type="button"
                  role="tab"
                  id="project-change-scope-session"
                  aria-selected={changeScope === "session"}
                  class:active={changeScope === "session"}
                  onclick={() => (changeScope = "session")}
                >{copy.projectChangesThisSession} ({sessionEntries.length})</button>
                <button
                  type="button"
                  role="tab"
                  id="project-change-scope-all"
                  aria-selected={changeScope === "all"}
                  class:active={changeScope === "all"}
                  onclick={() => (changeScope = "all")}
                >{copy.projectChangesAll} ({gitEntries.length})</button>
              </div>
              <p class="project-panel-scope">
                {changeScope === "session" ? copy.projectChangesSessionHint : copy.projectChangesHint}
              </p>
              {#if store.git?.status === "ok" && store.git.truncated}<p class="project-truncated-note">{copy.projectInspectionTruncated}</p>{/if}
              {#if visibleEntries.length}
                <ul class="project-entry-list project-change-list">
                  {#each visibleEntries as entry (entry.path)}
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <li class="project-entry" oncontextmenu={(event) => openContextMenu(event, entry.path, "file")} onkeydown={(event) => openContextMenuForKeyboard(event, entry.path, "file")}>
                      <button
                        type="button"
                        class="project-entry-button"
                        class:selected={activeTab?.kind === "diff" && activeTab.path === entry.path}
                        onclick={() => void store.openDiff(entry.path)}
                      >
                        <span class={`project-change-status status-${statusType(entry)}`}>{statusLabel(entry)}</span>
                        <span title={entry.path}>{entry.path}</span>
                        <small class="project-change-stats" title={changeStatsLabel(entry)}>
                          {#if entry.binary}
                            {copy.projectDiffBinary}
                          {:else}
                            <span class="project-change-additions">+{entry.additions === null ? "—" : entry.additions}</span>
                            <span class="project-change-deletions">−{entry.deletions === null ? "—" : entry.deletions}</span>
                          {/if}
                        </small>
                      </button>
                      <button
                        type="button"
                        class="project-entry-action"
                        aria-label={copy.projectMentionInChat}
                        title={copy.projectMentionInChat}
                        onclick={() => mentionInChat(entry.path)}
                      ><At size={16} aria-hidden="true" /></button>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="file-empty"><CodeFile size={20} aria-hidden="true" /><span>{copy.projectChangesSessionEmpty}</span></p>
              {/if}
            {:else if !store.gitLoading}
              <p class="file-empty"><CodeFile size={20} aria-hidden="true" /><span>{copy.projectChangesEmpty}</span></p>
            {/if}
          {:else}
            <p class="project-panel-scope">{copy.projectAttachmentsHint}</p>
            {#if attachmentsError}<div class="project-panel-error" role="alert">{attachmentsError}</div>{/if}
            {#if attachments.length}
              <ul class="project-entry-list project-attachment-list">
                {#each attachments as file (file.id)}
                  <li class="project-entry">
                    <div class="project-attachment-row">
                      <Paperclip size={16} aria-hidden="true" />
                      <span title={file.original}>{file.original}<small>{formatSize(file.size)}</small></span>
                      <button type="button" aria-label={copy.preview} title={copy.preview} onclick={() => openAttachment(file)}><Eye size={14} aria-hidden="true" /></button>
                      <button type="button" aria-label={copy.download} title={copy.download} onclick={() => void downloadAttachment(file)}><Download size={14} aria-hidden="true" /></button>
                    </div>
                    {#if expandedAttachment === file.id && attachmentPreview && attachmentUrl}
                      {@const attachmentKind = rawPreviewKindFromName(attachmentPreview.original)}
                      <div class="project-inline-preview">
                        {#if attachmentKind === "file"}
                          <p>{copy.projectAttachmentReady}</p>
                        {:else}
                          <MediaViewer
                            kind={attachmentKind}
                            src={attachmentUrl}
                            name={attachmentPreview.original}
                            sizeBytes={attachmentPreview.size}
                            {copy}
                          />
                        {/if}
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else if !attachmentsLoading}
              <p class="file-empty"><Paperclip size={20} aria-hidden="true" /><span>{copy.projectAttachmentsEmpty}</span></p>
            {/if}
          {/if}
        </div>

      {:else}
        <!--
          The Session artifact list. This is the Files surface of a conversation
          - the peer of the Project tree - so it lives inside the panel rather
          than in a second aside the host renders instead of this one: with a
          Mini App open the host had no way to show that aside, and switching
          the panel back to Files landed on an empty surface.
        -->
        <div class="project-browser artifact-session-browser" aria-busy={attachmentsLoading}>
          {#if tab === "turn"}
            <TurnFileList files={turnFiles} {copy} onOpen={selectTurnFile} />
          {:else}
            <div class="file-filters">
              {#each sessionFilters as [value, label] (value)}
                <button
                  type="button"
                  class:active={sessionFilter === value}
                  aria-pressed={sessionFilter === value}
                  onclick={() => (sessionFilter = value)}
                >{label}</button>
              {/each}
            </div>
            {#if attachmentsError}
              <div class="project-panel-error" role="alert">{attachmentsError}</div>
            {/if}
            {#if attachmentsLoading && attachments.length === 0}
              <p class="file-empty"><span>{copy.filesLoading}</span></p>
            {:else if filteredAttachments.length === 0}
              <p class="file-empty"><Paperclip size={20} aria-hidden="true" /><span>{copy.noFiles}</span></p>
            {:else}
              <ul class="project-entry-list project-session-file-list">
                {#each filteredAttachments as file (file.id)}
                  {@const FileIcon = FILE_KIND_ICONS[fileIconKind(file.original, "file")]}
                  <li class="project-entry">
                    <button
                      type="button"
                      class="project-entry-button"
                      class:selected={activeTab?.fileId === file.id}
                      title={file.original}
                      onclick={() => void store.openSessionFile(file)}
                    >
                      <FileIcon size={16} style={fileIconStyle(file.original, "file")} aria-hidden="true" />
                      <span>{file.original}</span>
                      <small class="project-entry-size">{formatSize(file.size)}</small>
                    </button>
                    <button
                      type="button"
                      class="project-entry-action"
                      aria-label={copy.download}
                      title={copy.download}
                      onclick={() => void downloadAttachment(file)}
                    ><Download size={14} aria-hidden="true" /></button>
                  </li>
                {/each}
              </ul>
             {/if}
           {/if}
         </div>
      {/if}

      {#if fileTabs.length}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="project-split-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label={copy.projectResizeViewer}
            aria-valuenow={splitPercent}
            aria-valuemin={20}
            aria-valuemax={80}
            tabindex="0"
            onpointerdown={startSplit}
            onpointermove={moveSplit}
            onpointerup={stopSplit}
            onpointercancel={stopSplit}
            onlostpointercapture={() => (splitting = false)}
            onkeydown={onSplitKeydown}
          ></div>

          <!--
            One viewer for both scopes, keyed on the open tab's own scope. A
            Project conversation can hold session tabs (a scratch image from the
            turn-files list), and they render through the session transports
            here without re-scoping the panel - the browser beside this viewer
            stays on whatever surface the user was reading.
          -->
          <section class="project-viewer" class:artifact-session-viewer={activeTab?.scope === "session"} aria-label={copy.projectViewer}>
            <div class="project-viewer-tabs" role="tablist" aria-label={copy.projectViewer} use:tablist>
              {#each fileTabs as openTab (openTab.id)}
                <div class="project-viewer-tab" class:active={openTab.id === store.activeFileTabId}>
                  <button
                    type="button"
                    role="tab"
                    id={`project-viewer-tab-${openTab.id}`}
                    aria-selected={openTab.id === store.activeFileTabId}
                    aria-controls={`project-viewer-panel-${openTab.id}`}
                    title={openTab.path || openTab.name}
                    onclick={() => store.selectTab(openTab.id, openTab.kind)}
                  >
                    {#if openTab.kind === "diff"}
                      <CodeFile class="project-viewer-tab-icon-diff" size={14} aria-hidden="true" />
                    {:else}
                      {@const TabIcon = FILE_KIND_ICONS[fileIconKind(openTab.name, "file")]}<TabIcon size={14} style={fileIconStyle(openTab.name, "file")} aria-hidden="true" />
                    {/if}
                    <span>{openTab.name}</span>
                  </button>
                  <button
                    type="button"
                    class="project-viewer-tab-close"
                    aria-label={copy.closeTab}
                    title={copy.closeTab}
                    onclick={() => handleCloseTab(openTab.id)}
                  ><X size={14} aria-hidden="true" /></button>
                </div>
              {/each}
              <button
                type="button"
                class="project-viewer-tab-clear"
                aria-label={browserCollapsed ? copy.projectExpandBrowser : copy.projectCollapseBrowser}
                title={browserCollapsed ? copy.projectExpandBrowser : copy.projectCollapseBrowser}
                onclick={toggleBrowser}
              >
                {#if browserCollapsed}<Expand size={16} aria-hidden="true" />{:else}<Compress size={16} aria-hidden="true" />{/if}
              </button>
              <button type="button" class="project-viewer-tab-clear" aria-label={copy.closeAllTabs} title={copy.closeAllTabs} onclick={() => store.closeAllTabs()}>
                <XCircle size={16} aria-hidden="true" />
              </button>
            </div>

            {#if activeTab}
              <div
                class="project-viewer-path"
                class:artifact-session-path={activeTab.scope === "session"}
                role="toolbar"
                tabindex={activeTab.scope === "project" ? -1 : undefined}
                aria-label={copy.projectViewer}
                oncontextmenu={activeTab.scope === "project" ? (event) => openContextMenu(event, activeTab.path, "file") : undefined}
              >
                {#if activeTab.scope === "project"}
                  <nav class="project-breadcrumb" aria-label={copy.projectPath}>
                    <button
                      type="button"
                      class="project-breadcrumb-crumb"
                      title={copy.projectBreadcrumbRoot}
                      aria-label={copy.projectBreadcrumbRoot}
                      onclick={() => { tab = "files"; browserCollapsed = false; store.collapseAllDirs(); }}
                    >
                      <Home size={16} aria-hidden="true" />
                    </button>
                    {#each breadcrumb as crumb (crumb.path)}
                      <CaretRight class="project-breadcrumb-sep" size={14} aria-hidden="true" />
                      <button
                        type="button"
                        class="project-breadcrumb-crumb"
                        class:is-last={crumb.isLast}
                        title={crumb.path}
                        onclick={async () => {
                          tab = "files";
                          browserCollapsed = false;
                          if (!crumb.isLast) await store.expandDir(crumb.path);
                          focusTreeRow(crumb.path);
                        }}
                      >{crumb.name}</button>
                    {/each}
                  </nav>
                {:else}
                  <strong class="artifact-session-name" title={activeTab.name}>{activeTab.name}</strong>
                {/if}
                {#if activeTab.kind === "diff"}
                  <button
                    type="button"
                    class="code-viewer-toggle"
                    class:active={diffLayout === "side-by-side"}
                    aria-pressed={diffLayout === "side-by-side"}
                    title={copy.projectDiffSideBySide}
                    aria-label={copy.projectDiffSideBySide}
                    onclick={() => (diffLayout = diffLayout === "side-by-side" ? "line-by-line" : "side-by-side")}
                  ><RowVertical size={16} aria-hidden="true" /></button>
                {/if}
                {#if sourceToggleAvailable && activeTab.kind === "file"}
                  <button
                    type="button"
                    class="code-viewer-toggle"
                    class:active={showSource}
                    aria-pressed={showSource}
                    title={copy.artifactShowSource}
                    aria-label={copy.artifactShowSource}
                    onclick={() => (showSource = !showSource)}
                  ><Code size={16} aria-hidden="true" /></button>
                {/if}
                {#if viewer === "html"}
                  <button
                    type="button"
                    class="code-viewer-toggle"
                    aria-label={copy.artifactRefresh}
                    title={copy.artifactRefresh}
                    onclick={() => (htmlRefreshKey += 1)}
                  ><Refresh size={16} aria-hidden="true" /></button>
                {/if}
                {#if activeTab.scope === "project"}
                  <button type="button" class="code-viewer-toggle" aria-label={copy.projectMentionInChat} title={copy.projectMentionInChat} onclick={() => mentionInChat(activeTab.path)}>
                    <At size={16} aria-hidden="true" />
                  </button>
                  <button type="button" class="code-viewer-toggle" aria-label={copy.projectCopyPath} title={copy.projectCopyPath} onclick={() => void copyPath(activeTab.path)}>
                    {#if copiedPath === activeTab.path}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}
                  </button>
                  <button type="button" class="code-viewer-toggle" aria-label={copy.artifactDownload} title={copy.artifactDownload} onclick={() => void downloadProjectFile(activeTab.path)}>
                    <Download size={14} aria-hidden="true" />
                  </button>
                  <button type="button" class="code-viewer-toggle" aria-label={copy.projectRevealInFinder} title={copy.projectRevealInFinder} onclick={() => void revealInFinder(activeTab.path, "reveal")}>
                    <FolderOpen size={14} aria-hidden="true" />
                  </button>
                  <button type="button" class="code-viewer-toggle" aria-label={copy.projectOpenExternally} title={copy.projectOpenExternally} onclick={() => void revealInFinder(activeTab.path, "open")}>
                    <SquareArrowUp size={14} aria-hidden="true" />
                  </button>
                {:else}
                  <!-- Same file actions as a Project tab, minus the `@` insertion:
                       an ordinary Session has no Project root for the Runtime to
                       validate a file reference against (PRD §3.35). -->
                  {#if activeTab.path}
                    <button type="button" class="code-viewer-toggle" aria-label={copy.projectCopyPath} title={copy.projectCopyPath} onclick={() => void copyPath(activeTab.path)}>
                      {#if copiedPath === activeTab.path}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}
                    </button>
                  {/if}
                  <button type="button" class="code-viewer-toggle" aria-label={copy.artifactDownload} title={copy.artifactDownload} onclick={() => void downloadSessionFile(activeTab)}>
                    <Download size={14} aria-hidden="true" />
                  </button>
                  {#if activeTab.path}
                    <button type="button" class="code-viewer-toggle" aria-label={copy.projectRevealInFinder} title={copy.projectRevealInFinder} onclick={() => void revealSessionFile(activeTab.path, "reveal")}>
                      <FolderOpen size={14} aria-hidden="true" />
                    </button>
                    <button type="button" class="code-viewer-toggle" aria-label={copy.projectOpenExternally} title={copy.projectOpenExternally} onclick={() => void revealSessionFile(activeTab.path, "open")}>
                      <SquareArrowUp size={14} aria-hidden="true" />
                    </button>
                  {/if}
                {/if}
              </div>

              <div id={`project-viewer-panel-${activeTab.id}`} class="project-viewer-body" role="tabpanel" aria-labelledby={`project-viewer-tab-${activeTab.id}`}>
                {#if activeTab.loading}
                  <div class="project-panel-loading"><Loader size={18} aria-hidden="true" />{copy.loading}</div>
                {:else if activeTab.error}
                  <div class="project-panel-error" role="alert">{activeTab.error}</div>
                {:else if activeTab.kind === "diff" && activeTab.diff}
                  {#if activeTab.diff.status === "diff"}
                    {#if activeTab.diff.truncated}<p class="project-truncated-note">{copy.projectInspectionTruncated}</p>{/if}
                    <div class="project-diff-preview">{@html diffHtml}</div>
                  {:else if activeTab.diff.status === "untracked" && activeTab.diff.preview.status === "text"}
                    <p class="project-preview-label">{copy.projectFileUntracked}</p>
                    <CodeViewer content={activeTab.diff.preview.content} filePath={activeTab.path} {copy} />
                  {:else if activeTab.diff.status !== "unavailable" && rawKind !== "file"}
                    <!-- A newly added image or video has no text diff; show the file itself. -->
                    <p class="project-preview-label">{copy.projectFileUntracked}</p>
                    <MediaViewer kind={rawKind} src={rawUrl} name={activeTab.name} {copy} />
                  {:else}
                    <p class="project-viewer-note">{activeTab.diff.status === "unavailable" ? activeTab.diff.reason : copy.projectBinaryFile}</p>
                  {/if}
                {:else if activeTab.kind === "file"}
                  {#if viewer === "html" && (htmlPreviewSrc || activeTab.blobUrl)}
                    <!-- Route URL first: a blob has no path, so relative assets
                         would not resolve. The blob is the external-transcript
                         fallback, where the route declines to serve. -->
                    <HtmlPreview src={htmlPreviewSrc || activeTab.blobUrl} refreshKey={htmlRefreshKey} />
                  {:else if viewer === "spreadsheet"}
                    <SpreadsheetTable
                      name={activeTab.name}
                      {copy}
                      sourceKey={activeTab.id}
                      version={activeTab.version}
                      loadBytes={loadActiveBinaryBytes}
                    />
                  {:else if viewer === "docx"}
                    <DocxPreview
                      name={activeTab.name}
                      {copy}
                      {theme}
                      sourceKey={activeTab.id}
                      version={activeTab.version}
                      loadBytes={loadActiveBinaryBytes}
                    />
                  {:else if viewer === "pptx"}
                    <PptxPreview
                      name={activeTab.name}
                      {copy}
                      {theme}
                      sourceKey={activeTab.id}
                      version={activeTab.version}
                      loadBytes={loadActiveBinaryBytes}
                    />
                  {:else if viewer === "svg" && activeMediaSrc}
                    <SvgViewer src={activeMediaSrc} source={activeText} name={activeTab.name} {showSource} {copy} />
                  {:else if viewer === "csv" && activeText}
                    <CsvTable content={activeText} name={activeTab.name} {copy} />
                  {:else if viewer === "markdown" && activeText}
                    <MarkdownPreview content={activeText} name={activeTab.name} {copy} {theme} {showSource} {endpoint} resolveImage={markdownImageResolver} />
                  {:else if viewer === "json" && activeText}
                    {#if activeTab.scope === "project" && activeTab.preview?.status === "text"}
                      <JsonTree
                        content={activeTab.preview.content}
                        name={activeTab.name}
                        {copy}
                        hasMoreBytes={activeTab.preview.truncated}
                        loadingMore={activeTab.loadingMore}
                        loadedBytes={activeTab.loadedBytes}
                        sizeBytes={activeTab.preview.sizeBytes}
                        onLoadMoreBytes={() => void store.loadMoreBytes(activeTab.id)}
                      />
                    {:else if activeTab.scope === "session"}
                      <JsonTree content={activeTab.textContent} name={activeTab.name} sizeBytes={activeTab.size} {copy} />
                    {/if}
                  {:else if viewer === "media" && activeMediaSrc}
                    <!-- Streamed raw bytes: works for any size, and lets video seek. -->
                    <MediaViewer
                      kind={rawKind}
                      src={activeMediaSrc}
                      name={activeTab.name}
                      sizeBytes={activeTab.scope === "project" ? (activeTab.preview?.sizeBytes ?? 0) : activeTab.size}
                      {copy}
                    />
                  {:else if viewer === "code" && activeText}
                    {#if activeTab.scope === "project" && activeTab.preview?.status === "text"}
                      <CodeViewer
                        content={activeTab.preview.content}
                        filePath={activeTab.path}
                        {copy}
                        revealLine={activeTab.revealLine}
                        onRevealed={() => store.clearReveal(activeTab.id)}
                        hasMoreBytes={activeTab.preview.truncated}
                        loadingMore={activeTab.loadingMore}
                        loadedBytes={activeTab.loadedBytes}
                        sizeBytes={activeTab.preview.sizeBytes}
                        onLoadMoreBytes={() => void store.loadMoreBytes(activeTab.id)}
                      />
                    {:else if activeTab.scope === "session"}
                      <CodeViewer content={activeTab.textContent} filePath={activeTab.name} {copy} />
                    {/if}
                  {:else if activeTab.scope === "project" && activeTab.preview}
                    <!-- No inline renderer: never a dead end, always a way out. -->
                    <SystemOpenCard
                      name={activeTab.name}
                      sizeBytes={activeTab.preview.sizeBytes}
                      reason={activeTab.preview.status === "binary"
                        ? (viewer === "system" ? copy.artifactUnsupportedFormat : copy.projectBinaryFile)
                        : copy.projectOversizedFile}
                      {copy}
                      onDownload={() => void downloadProjectFile(activeTab.path)}
                      onReveal={() => void revealInFinder(activeTab.path, "reveal")}
                      onOpenExternally={() => void revealInFinder(activeTab.path, "open")}
                    />
                  {:else if activeTab.scope === "session"}
                    <!-- An attachment does live in the Session workspace, so an
                         unsupported binary gets the system app here too, not only download. -->
                    <SystemOpenCard
                      name={activeTab.name}
                      sizeBytes={activeTab.size}
                      reason={viewer === "system" ? copy.artifactUnsupportedFormat : copy.projectBinaryFile}
                      {copy}
                      onDownload={() => void downloadSessionFile(activeTab)}
                      onReveal={activeTab.path ? () => void revealSessionFile(activeTab.path, "reveal") : undefined}
                      onOpenExternally={activeTab.path ? () => void revealSessionFile(activeTab.path, "open") : undefined}
                    />
                  {/if}
                {/if}
              </div>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  {/if}

  {#if !miniAppActive}
    {#if scope === "project"}
      <div class="file-panel-footer">
        <Eye size={14} aria-hidden="true" />
        <span>{store.watching ? copy.projectReadOnlyLiveHint : copy.projectReadOnlyHint}</span>
      </div>
    {:else}
      <div class="file-panel-footer">
        <Cloud size={20} aria-hidden="true" />
        <span>{attachments.length} {copy.files} · {formatSize(attachmentsTotalSize)}</span>
      </div>
    {/if}
  {/if}

  {#if menu}
    <FileContextMenu
      x={menu.x}
      y={menu.y}
      items={menu.items}
      onSelect={runMenuAction}
      onClose={() => (menu = null)}
    />
  {/if}
</aside>
