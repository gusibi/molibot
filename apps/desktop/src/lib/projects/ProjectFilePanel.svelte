<script lang="ts">
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import { untrack } from "svelte";
  import type { Translation } from "../i18n";
  import { mediaTypeFromName } from "@molibot/shared/filePreview";
  import {
    fetchDesktopFileBlob,
    listDesktopSessionFiles,
    loadDesktopProjectFile,
    loadDesktopProjectGitDiff,
    loadDesktopProjectGitStatus,
    loadDesktopProjectTree,
    type DesktopProjectFilePreview,
    type DesktopProjectGitDiff,
    type DesktopProjectGitStatus,
    type DesktopProjectTreePage
  } from "../api";
  import { html as renderDiffHtml } from "diff2html";

  let { endpoint, projectId, sessionId, copy, onClose }: {
    endpoint: string;
    projectId: string;
    sessionId: string;
    copy: Translation;
    onClose: () => void;
  } = $props();

  let tab = $state<"files" | "changes" | "attachments">("files");
  let tree = $state<DesktopProjectTreePage | null>(null);
  let treePath = $state("");
  let git = $state<DesktopProjectGitStatus | null>(null);
  let attachments = $state<DesktopSessionFile[]>([]);
  let expandedPath = $state("");
  let filePreview = $state<DesktopProjectFilePreview | null>(null);
  let diffPreview = $state<DesktopProjectGitDiff | null>(null);
  let attachmentUrl = $state("");
  let attachmentPreview = $state<DesktopSessionFile | null>(null);
  let loading = $state(false);
  let error = $state("");
  let copiedPath = $state("");
  let generation = 0;

  const pathParts = $derived(treePath ? treePath.split("/").filter(Boolean) : []);

  const diffHtml = $derived(
    diffPreview?.status === "diff" && diffPreview.content
      ? renderDiffHtml(diffPreview.content, {
          drawFileList: false,
          outputFormat: "line-by-line",
          matching: "lines",
          renderNothingWhenEmpty: false
        })
      : ""
  );

  function formatSize(bytes = 0): string {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${index === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
  }

  const FILE_ICON_BY_EXT: Record<string, string> = {
    ts: "ph-file-ts", tsx: "ph-file-tsx", mts: "ph-file-ts", cts: "ph-file-ts",
    js: "ph-file-js", jsx: "ph-file-jsx", mjs: "ph-file-js", cjs: "ph-file-js",
    vue: "ph-file-vue", svelte: "ph-file-code", astro: "ph-file-code",
    py: "ph-file-py", pyw: "ph-file-py", rs: "ph-file-rs",
    c: "ph-file-c", h: "ph-file-c", cpp: "ph-file-cpp", cc: "ph-file-cpp", cxx: "ph-file-cpp", hpp: "ph-file-cpp", hh: "ph-file-cpp",
    cs: "ph-file-c-sharp", java: "ph-file-code", kt: "ph-file-code", go: "ph-file-code", rb: "ph-file-code", php: "ph-file-code", swift: "ph-file-code",
    css: "ph-file-css", scss: "ph-file-css", sass: "ph-file-css", less: "ph-file-css",
    html: "ph-file-html", htm: "ph-file-html",
    md: "ph-file-md", mdx: "ph-file-md",
    json: "ph-file-code", json5: "ph-file-code", yaml: "ph-file-code", yml: "ph-file-code", toml: "ph-file-code", xml: "ph-file-code",
    sql: "ph-file-sql", graphql: "ph-file-code", prisma: "ph-file-code",
    sh: "ph-file-code", bash: "ph-file-code", zsh: "ph-file-code",
    ini: "ph-file-ini", conf: "ph-file-ini", cfg: "ph-file-ini", env: "ph-file-ini",
    csv: "ph-file-csv", tsv: "ph-file-csv",
    svg: "ph-file-svg", pdf: "ph-file-pdf",
    png: "ph-file-png", jpg: "ph-file-jpg", jpeg: "ph-file-jpg", gif: "ph-file-image", bmp: "ph-file-image", webp: "ph-file-image", ico: "ph-file-image",
    mp3: "ph-file-audio", wav: "ph-file-audio", flac: "ph-file-audio", m4a: "ph-file-audio", ogg: "ph-file-audio", aac: "ph-file-audio",
    mp4: "ph-file-video", mov: "ph-file-video", webm: "ph-file-video", avi: "ph-file-video", mkv: "ph-file-video",
    zip: "ph-file-zip", tar: "ph-file-archive", gz: "ph-file-archive", tgz: "ph-file-archive", rar: "ph-file-archive", "7z": "ph-file-archive",
    xls: "ph-file-xls", xlsx: "ph-file-xls", doc: "ph-file-doc", docx: "ph-file-doc", ppt: "ph-file-ppt", pptx: "ph-file-ppt",
    txt: "ph-file-txt", log: "ph-file-txt", lock: "ph-file-lock"
  };
  const FILE_ICON_COLOR_BY_EXT: Record<string, string> = {
    ts: "#3178c6", tsx: "#3178c6", mts: "#3178c6", cts: "#3178c6",
    js: "#e8d44d", jsx: "#e8d44d", mjs: "#e8d44d", cjs: "#e8d44d",
    vue: "#41b883", svelte: "#ff3e00", astro: "#a371f7",
    py: "#3776ab", rs: "#dea584",
    c: "#519aba", h: "#519aba", cpp: "#519aba", cc: "#519aba", cxx: "#519aba", hpp: "#519aba", hh: "#519aba",
    cs: "#178600", java: "#5382a1", kt: "#a97bff", go: "#00add8", rb: "#cc342d", php: "#777bb4", swift: "#f05138",
    css: "#2965f1", scss: "#c6538c", sass: "#cd6799", less: "#2965f1",
    html: "#e34c26", htm: "#e34c26",
    md: "#519aba", mdx: "#519aba",
    json: "#519aba", json5: "#519aba", yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221", xml: "#e37933",
    sql: "#e38c00", svg: "#ffb13b", pdf: "#e53935",
    png: "#a371f7", jpg: "#a371f7", jpeg: "#a371f7", gif: "#a371f7", bmp: "#a371f7", webp: "#a371f7", ico: "#a371f7",
    mp3: "#e879f9", wav: "#e879f9", flac: "#e879f9", m4a: "#e879f9", ogg: "#e879f9", aac: "#e879f9",
    mp4: "#e879f9", mov: "#e879f9", webm: "#e879f9", avi: "#e879f9", mkv: "#e879f9",
    zip: "#737373", tar: "#737373", gz: "#737373", rar: "#737373",
    xls: "#1d6f42", xlsx: "#1d6f42", csv: "#1d6f42", tsv: "#1d6f42",
    doc: "#2b579a", docx: "#2b579a", ppt: "#c43e1c", pptx: "#c43e1c", lock: "#a371f7"
  };
  function fileIcon(name: string, kind: string): string {
    if (kind === "directory") return "ph-folder-simple";
    if (kind === "symlink") return "ph-link";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    return FILE_ICON_BY_EXT[ext] || "ph-file-text";
  }
  function fileIconStyle(name: string, kind: string): string {
    if (kind !== "file") return "";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    return FILE_ICON_COLOR_BY_EXT[ext] ? `--file-color: ${FILE_ICON_COLOR_BY_EXT[ext]};` : "";
  }

  function statusLabel(entry: { indexStatus: string; worktreeStatus: string; untracked: boolean }): string {
    if (entry.untracked) return copy.projectFileUntracked;
    if (entry.indexStatus === "D" || entry.worktreeStatus === "D") return copy.projectFileDeleted;
    if (entry.indexStatus === "A") return copy.projectFileAdded;
    if (entry.indexStatus === "R") return copy.projectFileRenamed;
    return copy.projectFileModified;
  }

  function statusType(entry: { indexStatus: string; worktreeStatus: string; untracked: boolean }): string {
    if (entry.untracked) return "untracked";
    if (entry.indexStatus === "D" || entry.worktreeStatus === "D") return "deleted";
    if (entry.indexStatus === "A") return "added";
    if (entry.indexStatus === "R") return "renamed";
    return "modified";
  }

  async function loadActiveTab(): Promise<void> {
    const current = ++generation;
    loading = true;
    error = "";
    try {
      if (tab === "files") tree = await loadDesktopProjectTree(endpoint, projectId, treePath);
      else if (tab === "changes") git = await loadDesktopProjectGitStatus(endpoint, projectId);
      else attachments = sessionId ? await listDesktopSessionFiles(endpoint, "personal", sessionId, projectId) : [];
    } catch (cause) {
      if (current === generation) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (current === generation) loading = false;
    }
  }

  function collapseAll(): void {
    expandedPath = "";
    filePreview = null;
    diffPreview = null;
    closeAttachmentPreview();
  }

  function selectTab(next: "files" | "changes" | "attachments"): void {
    tab = next;
    collapseAll();
  }

  async function openTreePath(nextPath: string): Promise<void> {
    treePath = nextPath;
    collapseAll();
    await loadActiveTab();
  }

  async function loadMoreTree(): Promise<void> {
    if (!tree?.nextCursor || loading) return;
    loading = true;
    error = "";
    try {
      const next = await loadDesktopProjectTree(endpoint, projectId, treePath, tree.nextCursor);
      tree = { ...next, entries: [...tree.entries, ...next.entries] };
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { loading = false; }
  }

  async function openFile(filePath: string): Promise<void> {
    if (expandedPath === filePath) { collapseAll(); return; }
    collapseAll();
    expandedPath = filePath;
    loading = true;
    error = "";
    try { filePreview = await loadDesktopProjectFile(endpoint, projectId, filePath); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { loading = false; }
  }

  async function openDiff(filePath: string): Promise<void> {
    if (expandedPath === filePath) { collapseAll(); return; }
    collapseAll();
    expandedPath = filePath;
    loading = true;
    error = "";
    try { diffPreview = await loadDesktopProjectGitDiff(endpoint, projectId, filePath); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { loading = false; }
  }

  function buildRawFileUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath, raw: "true" });
    return `${endpoint}/api/settings/projects/${encodeURIComponent(projectId)}/inspection/file?${query.toString()}`;
  }

  async function openAttachment(file: DesktopSessionFile): Promise<void> {
    if (expandedPath === file.id) { collapseAll(); return; }
    collapseAll();
    expandedPath = file.id;
    loading = true;
    error = "";
    try {
      const blob = await fetchDesktopFileBlob(endpoint, "personal", sessionId, file.id, false, projectId);
      attachmentUrl = URL.createObjectURL(blob);
      attachmentPreview = file;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { loading = false; }
  }

  function closeAttachmentPreview(): void {
    if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
    attachmentUrl = "";
    attachmentPreview = null;
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
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }

  async function copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      copiedPath = path;
      setTimeout(() => { if (copiedPath === path) copiedPath = ""; }, 1200);
    } catch { /* clipboard unavailable */ }
  }

  $effect(() => {
    const identity = `${endpoint}:${projectId}:${sessionId}:${tab}`;
    untrack(() => {
      identity;
      treePath = "";
      collapseAll();
      void loadActiveTab();
    });
    return closeAttachmentPreview;
  });
</script>

<aside class="file-panel project-file-panel" aria-label={copy.projectFilesPanel}>
  <div class="file-panel-head">
    <i class="ph-fill ph-folder-simple file-panel-icon" aria-hidden="true"></i>
    <strong>{copy.projectFilesPanel}</strong>
    <button type="button" class="project-panel-refresh" aria-label={copy.projectRefresh} title={copy.projectRefresh} onclick={() => void loadActiveTab()}>
      <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
    </button>
    <button type="button" class="file-panel-close" aria-label={copy.closePanel} title={copy.closePanel} onclick={onClose}>
      <i class="ph ph-x" aria-hidden="true"></i>
    </button>
  </div>

  <div class="project-file-tabs" role="tablist" aria-label={copy.projectFilesPanel}>
    <button type="button" role="tab" aria-selected={tab === "files"} class:active={tab === "files"} onclick={() => selectTab("files")}>{copy.projectFilesTab}</button>
    <button type="button" role="tab" aria-selected={tab === "changes"} class:active={tab === "changes"} onclick={() => selectTab("changes")}>{copy.projectChangesTab}</button>
    <button type="button" role="tab" aria-selected={tab === "attachments"} class:active={tab === "attachments"} onclick={() => selectTab("attachments")}>{copy.projectAttachmentsTab}</button>
  </div>

  {#if error}<div class="project-panel-error" role="alert">{error}</div>{/if}

  <div class="project-panel-body">
    <div class="project-panel-content" aria-busy={loading}>
      {#if tab === "files"}
        <nav class="project-breadcrumb" aria-label={copy.projectPath}>
          <button type="button" aria-label={copy.projectFilesTab} title={copy.projectFilesTab} onclick={() => void openTreePath("")}><i class="ph ph-house" aria-hidden="true"></i></button>
          {#each pathParts as part, index (index)}
            <i class="ph ph-caret-right project-breadcrumb-sep" aria-hidden="true"></i><button type="button" onclick={() => void openTreePath(pathParts.slice(0, index + 1).join("/"))}>{part}</button>
          {/each}
        </nav>
        {#if tree?.entries.length}
          <ul class="project-entry-list">
            {#each tree.entries as entry (entry.path)}
              <li class="project-entry">
                <button type="button" class="project-entry-button" class:selected={expandedPath === entry.path} onclick={() => entry.kind === "directory" ? void openTreePath(entry.path) : entry.kind === "file" ? void openFile(entry.path) : undefined} disabled={entry.kind === "symlink"}>
                  <i class={`ph ${fileIcon(entry.name, entry.kind)}`} style={fileIconStyle(entry.name, entry.kind)} aria-hidden="true"></i>
                  <span title={entry.path}>{entry.name}</span>
                  {#if entry.sizeBytes !== undefined}<small>{formatSize(entry.sizeBytes)}</small>{/if}
                  {#if entry.kind === "file"}<i class="ph ph-caret-right project-entry-caret" class:open={expandedPath === entry.path} aria-hidden="true"></i>{/if}
                </button>
                {#if entry.kind === "file"}
                  <button type="button" class="project-entry-action" aria-label={copy.projectCopyPath} title={copy.projectCopyPath} onclick={() => void copyPath(entry.path)}>
                    <i class={`ph ph-${copiedPath === entry.path ? "check" : "copy"}`} aria-hidden="true"></i>
                  </button>
                {/if}
                {#if entry.kind === "file" && expandedPath === entry.path}
                  <div class="project-inline-preview" class:project-inline-media={filePreview && filePreview.status !== "text" && ["image", "audio", "video"].includes(mediaTypeFromName(filePreview.path))}>
                    {#if loading}
                      <div class="project-panel-loading"><i class="ph ph-spinner-gap" aria-hidden="true"></i>{copy.loading}</div>
                    {:else if filePreview}
                      {#if filePreview.status === "text"}
                        <pre>{filePreview.content}</pre>
                      {:else if mediaTypeFromName(filePreview.path) === "image"}
                        <img src={buildRawFileUrl(filePreview.path)} alt={filePreview.path.split("/").pop()} />
                      {:else if mediaTypeFromName(filePreview.path) === "audio"}
                        <audio src={buildRawFileUrl(filePreview.path)} controls></audio>
                      {:else if mediaTypeFromName(filePreview.path) === "video"}
                        <!-- svelte-ignore a11y_media_has_caption -->
                        <video src={buildRawFileUrl(filePreview.path)} controls></video>
                      {:else}
                        <p>{filePreview.status === "binary" ? copy.projectBinaryFile : copy.projectOversizedFile} · {formatSize(filePreview.sizeBytes)}</p>
                      {/if}
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {#if tree.nextCursor}<button type="button" class="project-load-more" onclick={() => void loadMoreTree()}>{copy.loadMore}</button>{/if}
        {:else if !loading}<p class="file-empty"><i class="ph ph-folder-open" aria-hidden="true"></i><span>{copy.projectFilesEmpty}</span></p>{/if}
      {:else if tab === "changes"}
        {#if git?.status === "unavailable"}<p class="file-empty"><i class="ph ph-git-branch" aria-hidden="true"></i><span>{copy.projectGitUnavailable}</span><small>{git.reason}</small></p>
        {:else if git?.status === "ok" && git.entries.length}
          <p class="project-panel-scope">{copy.projectChangesHint}</p>
          {#if git.truncated}<p class="project-truncated-note">{copy.projectInspectionTruncated}</p>{/if}
          <ul class="project-entry-list project-change-list">
            {#each git.entries as entry (entry.path)}
              <li class="project-entry">
                <button type="button" class="project-entry-button" class:selected={expandedPath === entry.path} onclick={() => void openDiff(entry.path)}>
                  <span class={`project-change-status status-${statusType(entry)}`}>{statusLabel(entry)}</span>
                  <span title={entry.path}>{entry.path}</span>
                  <i class="ph ph-caret-right project-entry-caret" class:open={expandedPath === entry.path} aria-hidden="true"></i>
                </button>
                {#if expandedPath === entry.path}
                  <div class="project-inline-preview project-inline-diff">
                    {#if loading}
                      <div class="project-panel-loading"><i class="ph ph-spinner-gap" aria-hidden="true"></i>{copy.loading}</div>
                    {:else if diffPreview}
                      {#if diffPreview.status === "diff"}{#if diffPreview.truncated}<p class="project-truncated-note">{copy.projectInspectionTruncated}</p>{/if}<div class="project-diff-preview">{@html diffHtml}</div>
                      {:else if diffPreview.status === "untracked" && diffPreview.preview?.status === "text"}<p class="project-preview-label">{copy.projectFileUntracked}</p><pre>{diffPreview.preview?.content}</pre>
                      {:else}<p>{diffPreview.status === "unavailable" ? diffPreview.reason : copy.projectBinaryFile}</p>{/if}
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {:else if !loading}<p class="file-empty"><i class="ph ph-git-diff" aria-hidden="true"></i><span>{copy.projectChangesEmpty}</span></p>{/if}
      {:else}
        <p class="project-panel-scope">{copy.projectAttachmentsHint}</p>
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
                {#if expandedPath === file.id && attachmentPreview && attachmentUrl}
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
        {:else if !loading}<p class="file-empty"><i class="ph ph-paperclip" aria-hidden="true"></i><span>{copy.projectAttachmentsEmpty}</span></p>{/if}
      {/if}
    </div>
  </div>

  <div class="file-panel-footer"><i class="ph ph-eye" aria-hidden="true"></i><span>{copy.projectReadOnlyHint}</span></div>
</aside>
