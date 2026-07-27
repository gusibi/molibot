<script lang="ts">
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import { onDestroy, untrack } from "svelte";
  import type { Translation } from "../i18n";
  import { mediaTypeFromName } from "@molibot/shared/filePreview";
  import { fetchDesktopFileBlob, listDesktopSessionFiles } from "../api";
  import { html as renderDiffHtml } from "diff2html";
  import CodeViewer from "./CodeViewer.svelte";
  import FileSearchPanel from "./FileSearchPanel.svelte";
  import FileTreeNode from "./FileTreeNode.svelte";
  import { fileIconName, fileIconStyle, formatSize } from "./fileIcons";
  import { ProjectFilesStore } from "./projectFilesStore.svelte";

  let { endpoint, projectId, sessionId, copy, onClose }: {
    endpoint: string;
    projectId: string;
    sessionId: string;
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
  let splitPercent = $state(clampSplit(Number(localStorage.getItem(SPLIT_KEY) || 0) || 52));
  let splitting = $state(false);
  let panelElement = $state<HTMLElement | null>(null);

  let diffLayout = $state<"line-by-line" | "side-by-side">("line-by-line");

  const activeTab = $derived(store.activeTab);
  const dirtyPaths = $derived(
    new Set(store.git?.status === "ok" ? store.git.entries.map((entry) => entry.path) : [])
  );
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

  function clampSplit(value: number): number {
    return Math.min(80, Math.max(20, Math.round(value)));
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

  function buildRawFileUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath, raw: "true" });
    return `${endpoint}/api/settings/projects/${encodeURIComponent(projectId)}/inspection/file?${query.toString()}`;
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
    if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
    attachmentUrl = "";
    attachmentPreview = null;
    expandedAttachment = "";
  }

  async function openAttachment(file: DesktopSessionFile): Promise<void> {
    if (expandedAttachment === file.id) { closeAttachmentPreview(); return; }
    closeAttachmentPreview();
    expandedAttachment = file.id;
    try {
      const blob = await fetchDesktopFileBlob(endpoint, "personal", sessionId, file.id, false, projectId);
      if (expandedAttachment !== file.id) return;
      attachmentUrl = URL.createObjectURL(blob);
      attachmentPreview = file;
    } catch (cause) {
      attachmentsError = cause instanceof Error ? cause.message : String(cause);
    }
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

  $effect(() => {
    const identity = `${endpoint}:${projectId}:${sessionId}`;
    untrack(() => {
      identity;
      closeAttachmentPreview();
      void loadAttachments();
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
        {#if dirtyPaths.size}<span class="project-tab-badge">{dirtyPaths.size}</span>{/if}
      </button>
      <button type="button" role="tab" aria-selected={tab === "attachments"} class:active={tab === "attachments"} onclick={() => (tab = "attachments")}>{copy.projectAttachmentsTab}</button>
    </div>

    <div class="project-panel-body">
      <div class="project-browser" aria-busy={store.dirs[""]?.loading || store.gitLoading}>
        {#if tab === "files"}
          <div class="project-browser-actions">
            <button type="button" onclick={() => store.collapseAllDirs()}>
              <i class="ph ph-arrows-in-line-vertical" aria-hidden="true"></i>{copy.projectCollapseAll}
            </button>
          </div>
          {#if store.dirs[""]?.error}
            <div class="project-panel-error" role="alert">{store.dirs[""].error}</div>
          {/if}
          <FileTreeNode {store} dirPath="" {copy} {dirtyPaths} onCopyPath={(path) => void copyPath(path)} {copiedPath} />
        {:else if tab === "changes"}
          {#if store.gitError}
            <div class="project-panel-error" role="alert">{store.gitError}</div>
          {:else if store.git?.status === "unavailable"}
            <p class="file-empty"><i class="ph ph-git-branch" aria-hidden="true"></i><span>{copy.projectGitUnavailable}</span><small>{store.git.reason}</small></p>
          {:else if store.git?.status === "ok" && store.git.entries.length}
            <p class="project-panel-scope">{copy.projectChangesHint}</p>
            {#if store.git.truncated}<p class="project-truncated-note">{copy.projectInspectionTruncated}</p>{/if}
            <ul class="project-entry-list project-change-list">
              {#each store.git.entries as entry (entry.path)}
                <li class="project-entry">
                  <button
                    type="button"
                    class="project-entry-button"
                    class:selected={activeTab?.kind === "diff" && activeTab.path === entry.path}
                    onclick={() => void store.openDiff(entry.path)}
                  >
                    <span class={`project-change-status status-${statusType(entry)}`}>{statusLabel(entry)}</span>
                    <span title={entry.path}>{entry.path}</span>
                  </button>
                </li>
              {/each}
            </ul>
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
                    <button type="button" aria-label={copy.preview} title={copy.preview} onclick={() => void openAttachment(file)}><i class="ph ph-eye" aria-hidden="true"></i></button>
                    <button type="button" aria-label={copy.download} title={copy.download} onclick={() => void downloadAttachment(file)}><i class="ph ph-download-simple" aria-hidden="true"></i></button>
                  </div>
                  {#if expandedAttachment === file.id && attachmentPreview && attachmentUrl}
                    <div class="project-inline-preview project-inline-media">
                      {#if attachmentPreview.mediaType === "image"}<img src={attachmentUrl} alt={attachmentPreview.original} />
                      {:else if attachmentPreview.mediaType === "audio"}<audio src={attachmentUrl} controls></audio>
                      {:else if attachmentPreview.mediaType === "video"}<!-- svelte-ignore a11y_media_has_caption --><video src={attachmentUrl} controls></video>
                      {:else}<p>{copy.projectAttachmentReady}</p>{/if}
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
            <button type="button" class="project-viewer-tab-clear" aria-label={copy.closeAllTabs} title={copy.closeAllTabs} onclick={() => store.closeAllTabs()}>
              <i class="ph ph-x-circle" aria-hidden="true"></i>
            </button>
          </div>

          {#if activeTab}
            <div class="project-viewer-path">
              <span title={activeTab.path}>{activeTab.path}</span>
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
              <button type="button" class="code-viewer-toggle" aria-label={copy.projectCopyPath} title={copy.projectCopyPath} onclick={() => void copyPath(activeTab.path)}>
                <i class={`ph ph-${copiedPath === activeTab.path ? "check" : "copy"}`} aria-hidden="true"></i>
              </button>
            </div>

            <div class="project-viewer-body">
              {#if activeTab.loading}
                <div class="project-panel-loading"><i class="ph ph-spinner-gap" aria-hidden="true"></i>{copy.loading}</div>
              {:else if activeTab.error}
                <div class="project-panel-error" role="alert">{activeTab.error}</div>
              {:else if activeTab.kind === "file" && activeTab.preview}
                {#if activeTab.preview.status === "text"}
                  {#if activeTab.preview.truncated}<p class="project-truncated-note">{copy.projectInspectionTruncated}</p>{/if}
                  <CodeViewer
                    content={activeTab.preview.content}
                    filePath={activeTab.path}
                    {copy}
                    revealLine={activeTab.revealLine}
                    onRevealed={() => store.clearReveal(activeTab.id)}
                  />
                {:else if mediaTypeFromName(activeTab.path) === "image"}
                  <div class="project-inline-media"><img src={buildRawFileUrl(activeTab.path)} alt={activeTab.name} /></div>
                {:else if mediaTypeFromName(activeTab.path) === "audio"}
                  <div class="project-inline-media"><audio src={buildRawFileUrl(activeTab.path)} controls></audio></div>
                {:else if mediaTypeFromName(activeTab.path) === "video"}
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <div class="project-inline-media"><video src={buildRawFileUrl(activeTab.path)} controls></video></div>
                {:else}
                  <p class="project-viewer-note">{activeTab.preview.status === "binary" ? copy.projectBinaryFile : copy.projectOversizedFile} · {formatSize(activeTab.preview.sizeBytes)}</p>
                {/if}
              {:else if activeTab.kind === "diff" && activeTab.diff}
                {#if activeTab.diff.status === "diff"}
                  {#if activeTab.diff.truncated}<p class="project-truncated-note">{copy.projectInspectionTruncated}</p>{/if}
                  <div class="project-diff-preview">{@html diffHtml}</div>
                {:else if activeTab.diff.status === "untracked" && activeTab.diff.preview.status === "text"}
                  <p class="project-preview-label">{copy.projectFileUntracked}</p>
                  <CodeViewer content={activeTab.diff.preview.content} filePath={activeTab.path} {copy} />
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
</aside>
