<script lang="ts">
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import { onDestroy, untrack } from "svelte";
  import type { Translation } from "../i18n";
  import { isRenderableTextName, rawPreviewKindFromName } from "@molibot/shared/filePreview";
  import { desktopFileContentUrl, fetchDesktopFileBlob, listDesktopSessionFiles } from "../api";
  import { html as renderDiffHtml } from "diff2html";
  import CodeViewer from "./CodeViewer.svelte";
  import FileContextMenu from "./FileContextMenu.svelte";
  import FileSearchPanel from "./FileSearchPanel.svelte";
  import FileTreeNode from "./FileTreeNode.svelte";
  import MediaViewer from "./MediaViewer.svelte";
  import { fileIconName, fileIconStyle, formatSize } from "./fileIcons";
  import type { FileMenuItem } from "./fileMenu";
  import { flattenTree, ProjectFilesStore } from "./projectFilesStore.svelte";
  import { requestComposerInsertion } from "./composerBridge";
  import type { SessionFileTouches } from "./sessionFileTouches";

  let { endpoint, projectId, sessionId, touches, copy, onClose }: {
    endpoint: string;
    projectId: string;
    sessionId: string;
    /** Files the active session touched, for marking and the session change scope. */
    touches: SessionFileTouches;
    copy: Translation;
    onClose: () => void;
  } = $props();

  const store = new ProjectFilesStore();

  let tab = $state<"files" | "changes" | "attachments">("files");
  let attachments = $state<DesktopSessionFile[]>([]);
  let attachmentsLoading = $state(false);
  let attachmentsError = $state("");
  let attachmentUrl = $state("");
  let attachmentPreview = $state<DesktopSessionFile | null>(null);
  let expandedAttachment = $state("");
  let copiedPath = $state("");
  let attachmentGeneration = 0;

  /** Split position between the browser and the viewer, as a percentage of panel height. */
  const SPLIT_KEY = "molibot-desktop-file-split";
  const COLLAPSE_KEY = "molibot-desktop-file-browser-collapsed";
  const FOLLOW_KEY = "molibot-desktop-file-follow";
  let splitPercent = $state(clampSplit(Number(localStorage.getItem(SPLIT_KEY) || 0) || 52));
  let splitting = $state(false);
  let panelElement = $state<HTMLElement | null>(null);
  let browserElement = $state<HTMLElement | null>(null);

  /** Hides the browser so the viewer owns the whole panel — the panel is only ~380px wide. */
  let browserCollapsed = $state(localStorage.getItem(COLLAPSE_KEY) === "1");
  /** Opens the diff of whatever the agent just wrote, the way a pair would follow along. */
  let followAgentWrites = $state(localStorage.getItem(FOLLOW_KEY) !== "0");
  let lastFollowedPath = $state("");
  let followSession = $state("");

  let diffLayout = $state<"line-by-line" | "side-by-side">("line-by-line");
  /** SVG opens rendered; the toggle drops back to its source. */
  let svgAsSource = $state(false);

  let menu = $state<{ x: number; y: number; path: string; kind: string; items: FileMenuItem[] } | null>(null);
  let actionError = $state("");

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
  const rawKind = $derived(activeTab ? rawPreviewKindFromName(activeTab.path) : "file");
  const rawUrl = $derived(activeTab ? store.rawFileUrl(activeTab.path) : "");
  const svgRenderable = $derived(Boolean(activeTab && isRenderableTextName(activeTab.path)));

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

  function openContextMenu(event: MouseEvent, path: string, kind: string): void {
    event.preventDefault();
    event.stopPropagation();
    const isDirectory = kind === "directory";
    const items: FileMenuItem[] = [
      isDirectory
        ? { id: "toggle", label: store.expanded[path] ? copy.projectCollapseFolder : copy.projectExpandFolder, icon: "ph-caret-right" }
        : { id: "open", label: copy.projectOpenFile, icon: "ph-file-arrow-up" },
      { id: "diff", label: copy.projectViewDiff, icon: "ph-git-diff", disabled: isDirectory || !dirtyPaths.has(path) },
      { id: "mention", label: copy.projectMentionInChat, icon: "ph-at", startsGroup: true },
      { id: "copy", label: copy.projectCopyPath, icon: "ph-copy" },
      { id: "reveal", label: copy.projectRevealInFinder, icon: "ph-folder-open", startsGroup: true },
      { id: "external", label: copy.projectOpenExternally, icon: "ph-arrow-square-out" }
    ];
    menu = { x: event.clientX, y: event.clientY, path, kind, items };
  }

  function runMenuAction(id: string): void {
    const target = menu;
    if (!target) return;
    if (id === "toggle") store.toggleDir(target.path);
    else if (id === "open") void store.openFile(target.path);
    else if (id === "diff") void store.openDiff(target.path);
    else if (id === "mention") mentionInChat(target.path);
    else if (id === "copy") void copyPath(target.path);
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

  /** Finder/VS Code arrow-key semantics: ← collapses or climbs, → expands or descends. */
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

  async function loadAttachments(): Promise<void> {
    const current = ++attachmentGeneration;
    attachmentsLoading = true;
    attachmentsError = "";
    try {
      const files = sessionId ? await listDesktopSessionFiles(endpoint, "personal", sessionId, projectId) : [];
      if (current === attachmentGeneration) attachments = files;
    } catch (cause) {
      if (current === attachmentGeneration) attachmentsError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (current === attachmentGeneration) attachmentsLoading = false;
    }
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
    attachmentUrl = desktopFileContentUrl(endpoint, "personal", sessionId, file.id, false, projectId);
    attachmentPreview = file;
  }

  async function downloadAttachment(file: DesktopSessionFile): Promise<void> {
    try {
      const blob = await fetchDesktopFileBlob(endpoint, "personal", sessionId, file.id, true, projectId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.original;
      anchor.click();
      URL.revokeObjectURL(url);
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

  $effect(() => {
    const nextEndpoint = endpoint;
    const nextProjectId = projectId;
    untrack(() => store.connect(nextEndpoint, nextProjectId));
  });

  // An SVG always opens rendered; the source toggle is per file, not sticky.
  $effect(() => {
    store.activeTabId;
    untrack(() => { svgAsSource = false; });
  });

  $effect(() => {
    const identity = `${endpoint}:${projectId}:${sessionId}`;
    untrack(() => {
      identity;
      closeAttachmentPreview();
      void loadAttachments();
    });
  });

  // Follow the agent: when it writes a new file, surface that file's diff and
  // point the tree at it, so the panel keeps up with the run without clicking.
  // Opening a session adopts its existing history silently — only writes that
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
      void store.openDiff(latest);
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
  class="file-panel project-file-panel"
  class:splitting
  aria-label={copy.projectFilesPanel}
  bind:this={panelElement}
  style={`--file-split:${splitPercent}%`}
  onkeydown={onPanelKeydown}
>
  <div class="file-panel-head">
    <i class="ph-fill ph-folder-simple file-panel-icon" aria-hidden="true"></i>
    <strong>{copy.projectFilesPanel}</strong>
    <button
      type="button"
      class="project-panel-refresh"
      class:active={store.searchOpen}
      aria-label={copy.projectSearch}
      title={`${copy.projectSearch} (⌘P)`}
      onclick={() => (store.searchOpen ? store.closeSearch() : (store.searchOpen = true))}
    >
      <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
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
      <i class="ph ph-crosshair-simple" aria-hidden="true"></i>
    </button>
    <button
      type="button"
      class="project-panel-refresh"
      aria-label={copy.projectRefresh}
      title={store.watching ? copy.projectWatchLive : copy.projectRefresh}
      onclick={() => store.refreshAll()}
    >
      <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
      {#if store.watching}<span class="project-watch-dot" aria-hidden="true"></span>{/if}
    </button>
    <button type="button" class="file-panel-close" aria-label={copy.closePanel} title={copy.closePanel} onclick={onClose}>
      <i class="ph ph-x" aria-hidden="true"></i>
    </button>
  </div>

  {#if store.searchOpen}
    <FileSearchPanel {store} {copy} />
  {:else}
    <div class="project-file-tabs" role="tablist" aria-label={copy.projectFilesPanel}>
      <button type="button" role="tab" aria-selected={tab === "files"} class:active={tab === "files"} onclick={() => (tab = "files")}>{copy.projectFilesTab}</button>
      <button type="button" role="tab" aria-selected={tab === "changes"} class:active={tab === "changes"} onclick={() => (tab = "changes")}>
        {copy.projectChangesTab}
        {#if sessionEntries.length}
          <span class="project-tab-badge is-session">{sessionEntries.length}</span>
        {:else if dirtyPaths.size}
          <span class="project-tab-badge">{dirtyPaths.size}</span>
        {/if}
      </button>
      <button type="button" role="tab" aria-selected={tab === "attachments"} class:active={tab === "attachments"} onclick={() => (tab = "attachments")}>{copy.projectAttachmentsTab}</button>
    </div>

    <div class="project-panel-body" class:browser-collapsed={browserCollapsed && store.tabs.length}>
      {#if actionError}
        <div class="project-panel-error" role="alert">{actionError}</div>
      {/if}
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
        {#if tab === "files"}
          <div class="project-browser-actions">
            <button type="button" onclick={() => store.collapseAllDirs()}>
              <i class="ph ph-arrows-in-line-vertical" aria-hidden="true"></i>{copy.projectCollapseAll}
            </button>
          </div>
          {#if store.dirs[""]?.error}
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
            <p class="file-empty"><i class="ph ph-git-branch" aria-hidden="true"></i><span>{copy.projectGitUnavailable}</span><small>{store.git.reason}</small></p>
          {:else if gitEntries.length}
            <div class="project-change-scope" role="tablist" aria-label={copy.projectChangesTab}>
              <button
                type="button"
                role="tab"
                aria-selected={changeScope === "session"}
                class:active={changeScope === "session"}
                onclick={() => (changeScope = "session")}
              >{copy.projectChangesThisSession} ({sessionEntries.length})</button>
              <button
                type="button"
                role="tab"
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
                  <li class="project-entry" oncontextmenu={(event) => openContextMenu(event, entry.path, "file")}>
                    <button
                      type="button"
                      class="project-entry-button"
                      class:selected={activeTab?.kind === "diff" && activeTab.path === entry.path}
                      onclick={() => void store.openDiff(entry.path)}
                    >
                      <span class={`project-change-status status-${statusType(entry)}`}>{statusLabel(entry)}</span>
                      <span title={entry.path}>{entry.path}</span>
                    </button>
                    <button
                      type="button"
                      class="project-entry-action"
                      aria-label={copy.projectMentionInChat}
                      title={copy.projectMentionInChat}
                      onclick={() => mentionInChat(entry.path)}
                    ><i class="ph ph-at" aria-hidden="true"></i></button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="file-empty"><i class="ph ph-git-diff" aria-hidden="true"></i><span>{copy.projectChangesSessionEmpty}</span></p>
            {/if}
          {:else if !store.gitLoading}
            <p class="file-empty"><i class="ph ph-git-diff" aria-hidden="true"></i><span>{copy.projectChangesEmpty}</span></p>
          {/if}
        {:else}
          <p class="project-panel-scope">{copy.projectAttachmentsHint}</p>
          {#if attachmentsError}<div class="project-panel-error" role="alert">{attachmentsError}</div>{/if}
          {#if attachments.length}
            <ul class="project-entry-list project-attachment-list">
              {#each attachments as file (file.id)}
                <li class="project-entry">
                  <div class="project-attachment-row">
                    <i class="ph ph-paperclip" aria-hidden="true"></i>
                    <span title={file.original}>{file.original}<small>{formatSize(file.size)}</small></span>
                    <button type="button" aria-label={copy.preview} title={copy.preview} onclick={() => openAttachment(file)}><i class="ph ph-eye" aria-hidden="true"></i></button>
                    <button type="button" aria-label={copy.download} title={copy.download} onclick={() => void downloadAttachment(file)}><i class="ph ph-download-simple" aria-hidden="true"></i></button>
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
            <p class="file-empty"><i class="ph ph-paperclip" aria-hidden="true"></i><span>{copy.projectAttachmentsEmpty}</span></p>
          {/if}
        {/if}
      </div>

      {#if store.tabs.length}
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

        <section class="project-viewer" aria-label={copy.projectViewer}>
          <div class="project-viewer-tabs" role="tablist" aria-label={copy.projectViewer}>
            {#each store.tabs as openTab (openTab.id)}
              <div class="project-viewer-tab" class:active={openTab.id === store.activeTabId}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={openTab.id === store.activeTabId}
                  title={openTab.path}
                  onclick={() => (store.activeTabId = openTab.id)}
                >
                  {#if openTab.kind === "diff"}
                    <i class="ph ph-git-diff" aria-hidden="true"></i>
                  {:else}
                    <i class={`ph ${fileIconName(openTab.name, "file")}`} style={fileIconStyle(openTab.name, "file")} aria-hidden="true"></i>
                  {/if}
                  <span>{openTab.name}</span>
                </button>
                <button
                  type="button"
                  class="project-viewer-tab-close"
                  aria-label={copy.closeTab}
                  title={copy.closeTab}
                  onclick={() => store.closeTab(openTab.id)}
                ><i class="ph ph-x" aria-hidden="true"></i></button>
              </div>
            {/each}
            <button
              type="button"
              class="project-viewer-tab-clear"
              aria-label={browserCollapsed ? copy.projectExpandBrowser : copy.projectCollapseBrowser}
              title={browserCollapsed ? copy.projectExpandBrowser : copy.projectCollapseBrowser}
              onclick={toggleBrowser}
            >
              <i class={`ph ${browserCollapsed ? "ph-arrows-out-line-vertical" : "ph-arrows-in-line-vertical"}`} aria-hidden="true"></i>
            </button>
            <button type="button" class="project-viewer-tab-clear" aria-label={copy.closeAllTabs} title={copy.closeAllTabs} onclick={() => store.closeAllTabs()}>
              <i class="ph ph-x-circle" aria-hidden="true"></i>
            </button>
          </div>

          {#if activeTab}
            <div
              class="project-viewer-path"
              role="toolbar"
              tabindex={-1}
              aria-label={copy.projectViewer}
              oncontextmenu={(event) => openContextMenu(event, activeTab.path, "file")}
            >
              <nav class="project-breadcrumb" aria-label={copy.projectPath}>
                <button
                  type="button"
                  class="project-breadcrumb-crumb"
                  title={copy.projectBreadcrumbRoot}
                  aria-label={copy.projectBreadcrumbRoot}
                  onclick={() => { tab = "files"; browserCollapsed = false; store.collapseAllDirs(); }}
                >
                  <i class="ph ph-house-simple" aria-hidden="true"></i>
                </button>
                {#each breadcrumb as crumb (crumb.path)}
                  <i class="ph ph-caret-right project-breadcrumb-sep" aria-hidden="true"></i>
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
              {#if activeTab.kind === "diff"}
                <button
                  type="button"
                  class="code-viewer-toggle"
                  class:active={diffLayout === "side-by-side"}
                  aria-pressed={diffLayout === "side-by-side"}
                  title={copy.projectDiffSideBySide}
                  aria-label={copy.projectDiffSideBySide}
                  onclick={() => (diffLayout = diffLayout === "side-by-side" ? "line-by-line" : "side-by-side")}
                ><i class="ph ph-columns" aria-hidden="true"></i></button>
              {/if}
              {#if svgRenderable && activeTab.kind === "file"}
                <button
                  type="button"
                  class="code-viewer-toggle"
                  class:active={svgAsSource}
                  aria-pressed={svgAsSource}
                  title={copy.projectShowSource}
                  aria-label={copy.projectShowSource}
                  onclick={() => (svgAsSource = !svgAsSource)}
                ><i class="ph ph-code" aria-hidden="true"></i></button>
              {/if}
              <button type="button" class="code-viewer-toggle" aria-label={copy.projectMentionInChat} title={copy.projectMentionInChat} onclick={() => mentionInChat(activeTab.path)}>
                <i class="ph ph-at" aria-hidden="true"></i>
              </button>
              <button type="button" class="code-viewer-toggle" aria-label={copy.projectCopyPath} title={copy.projectCopyPath} onclick={() => void copyPath(activeTab.path)}>
                <i class={`ph ph-${copiedPath === activeTab.path ? "check" : "copy"}`} aria-hidden="true"></i>
              </button>
              <button type="button" class="code-viewer-toggle" aria-label={copy.projectRevealInFinder} title={copy.projectRevealInFinder} onclick={() => void revealInFinder(activeTab.path, "reveal")}>
                <i class="ph ph-folder-open" aria-hidden="true"></i>
              </button>
            </div>

            <div class="project-viewer-body">
              {#if activeTab.loading}
                <div class="project-panel-loading"><i class="ph ph-spinner-gap" aria-hidden="true"></i>{copy.loading}</div>
              {:else if activeTab.error}
                <div class="project-panel-error" role="alert">{activeTab.error}</div>
              {:else if activeTab.kind === "file" && activeTab.preview}
                {#if activeTab.preview.status === "text" && !(svgRenderable && !svgAsSource)}
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
                {:else if rawKind !== "file"}
                  <!-- Streamed raw bytes: works for any size, and lets video seek. -->
                  <MediaViewer
                    kind={rawKind}
                    src={rawUrl}
                    name={activeTab.name}
                    sizeBytes={activeTab.preview.sizeBytes}
                    {copy}
                  />
                {:else}
                  <p class="project-viewer-note">{activeTab.preview.status === "binary" ? copy.projectBinaryFile : copy.projectOversizedFile} · {formatSize(activeTab.preview.sizeBytes)}</p>
                  <button type="button" class="code-viewer-more" onclick={() => void revealInFinder(activeTab.path, "open")}>
                    {copy.projectOpenExternally}
                  </button>
                {/if}
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
              {/if}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  {/if}

  <div class="file-panel-footer">
    <i class="ph ph-eye" aria-hidden="true"></i>
    <span>{store.watching ? copy.projectReadOnlyLiveHint : copy.projectReadOnlyHint}</span>
  </div>

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
