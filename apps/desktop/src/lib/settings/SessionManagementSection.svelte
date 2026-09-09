<script lang="ts">
  import { untrack } from "svelte";
  import type { DesktopExtractionStatus, DesktopManagedSessionItem, DesktopManagedViewState } from "../api";
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import {
    fetchDesktopFileBlob,
    listDesktopSessionFiles
  } from "../api";
  import type { Translation } from "../i18n";
  import { saveBlobAsFile } from "../saveFile";
  import { formatMessageTime } from "../chat/messageTime";
  import ConversationTranscript from "../chat/ConversationTranscript.svelte";
  import type { TranscriptAttachmentActions, TranscriptMessage } from "../chat/transcript";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import { formatNaturalDateTime } from "../presentation";
  import { session, navigateSettings } from "../stores/session.svelte";
  import {
    SESSION_MANAGEMENT_PAGE_SIZE,
    sessionManagementStore,
    sessionExtractionLabel,
    sessionManagementSelectedCount,
    loadManagedSessions,
    applySessionFilters,
    setSessionView,
    resetSessionFilters,
    turnSessionPage,
    toggleSessionRow,
    toggleSessionPage,
    selectAllMatchingSessions,
    openSessionPreview,
    closeSessionPreview,
    runSessionBulk,
    requestSessionDelete,
    cancelSessionDelete,
    retrySessionBulk,
    runSessionExtraction,
    loadSessionPolicy,
    refreshSessionPolicyPreview,
    saveSessionPolicy,
    applySessionBotOverride,
    removeSessionBotOverride
  } from "../stores/sessionManagement.svelte";

  let newBotId = $state("");
  let newBotMode = $state<"inherit" | "disabled" | "custom">("inherit");
  let newBotDays = $state(30);

  // Preview-modal attachment media: mirrors ChatView's transcript media maps —
  // files provide the record, blobs become object URLs keyed by `local` path.
  let previewFiles = $state<DesktopSessionFile[]>([]);
  let previewMediaUrls = $state(new Map<string, string>());
  let previewMediaLoading = $state(new Set<string>());
  let previewMediaFailed = $state(new Set<string>());
  let previewCopiedId = $state("");
  let previewCopiedTimer: ReturnType<typeof setTimeout> | null = null;

  const endpoint = $derived(session.serviceReady && session.endpoint ? session.endpoint : "");
  const previewItem = $derived(sessionManagementStore.previewItem);
  const previewFileByLocal = $derived(new Map(previewFiles.map((file) => [file.local, file])));
  const viewTabs = $derived<Array<{ id: DesktopManagedViewState; label: string; count: number }>>([
    { id: "active", label: session.text.sessionMgmtTabActive, count: sessionManagementStore.counts.active },
    { id: "archived", label: session.text.sessionMgmtTabArchived, count: sessionManagementStore.counts.archived },
    { id: "trashed", label: session.text.sessionMgmtTabTrash, count: sessionManagementStore.counts.trashed }
  ]);
  const sourceOptions = $derived([
    { value: "all", label: session.text.sessionMgmtSourceAll },
    { value: "local", label: session.text.sessionMgmtSourceLocal },
    { value: "project", label: session.text.sessionMgmtSourceProject },
    { value: "external", label: session.text.sessionMgmtSourceExternal }
  ]);
  const inactiveOptions = $derived([
    { value: "any", label: session.text.sessionMgmtInactiveAny },
    { value: "7", label: session.text.sessionMgmtInactive7 },
    { value: "30", label: session.text.sessionMgmtInactive30 },
    { value: "90", label: session.text.sessionMgmtInactive90 }
  ]);
  const extractionOptions = $derived([
    { value: "any", label: session.text.sessionMgmtExtractionAll },
    { value: "unprocessed", label: session.text.sessionMgmtStUnprocessed },
    { value: "saved", label: session.text.sessionMgmtStSaved },
    { value: "no-useful-information", label: session.text.sessionMgmtStNoUseful },
    { value: "pending-review", label: session.text.sessionMgmtStPending },
    { value: "partially-processed", label: session.text.sessionMgmtStPartial },
    { value: "failed", label: session.text.sessionMgmtStFailed }
  ]);
  const botModeOptions = $derived([
    { value: "inherit", label: session.text.sessionMgmtModeInherit },
    { value: "disabled", label: session.text.sessionMgmtModeDisabled },
    { value: "custom", label: session.text.sessionMgmtModeCustom }
  ]);
  const selCount = $derived(sessionManagementSelectedCount());
  const pageIds = $derived(sessionManagementStore.items.map((item) => item.conversationId));
  const allChecked = $derived(pageIds.length > 0 && pageIds.every((id) => id in sessionManagementStore.selected));
  const showRestore = $derived(sessionManagementStore.view !== "active");
  const pageIdx = $derived(Math.floor(sessionManagementStore.pageOffset / SESSION_MANAGEMENT_PAGE_SIZE));
  const pageCount = $derived(Math.max(1, Math.ceil(sessionManagementStore.total / SESSION_MANAGEMENT_PAGE_SIZE)));
  const consequenceText = $derived(
    sessionManagementStore.view === "active"
      ? session.text.sessionMgmtConsequenceArchive
      : session.text.sessionMgmtConsequenceRestore
  );

  $effect(() => {
    const readyEndpoint = session.serviceReady ? session.endpoint : null;
    if (readyEndpoint) {
      untrack(() => {
        if (readyEndpoint !== sessionManagementStore.endpoint) {
          void loadManagedSessions(readyEndpoint);
          void loadSessionPolicy(readyEndpoint);
        }
      });
    }
  });

  function fill(template: string, values: Record<string, string | number>): string {
    let out = template;
    for (const [key, value] of Object.entries(values)) out = out.replace(`{${key}}`, String(value));
    return out;
  }

  function rowExtractionStatus(item: DesktopManagedSessionItem): DesktopExtractionStatus {
    if (item.conversationId in sessionManagementStore.extractingIds) return "processing";
    return item.extractionStatus;
  }

  function sourceLabel(item: DesktopManagedSessionItem, copy: Translation): string {
    if (item.source === "project") return item.projectId ? `${copy.sessionMgmtSourceProject} · ${item.projectId}` : copy.sessionMgmtSourceProject;
    if (item.source === "external") return item.botId ? `${item.channel} · ${item.botId}` : copy.sessionMgmtSourceExternal;
    return item.botId ? `${copy.sessionMgmtSourceLocal} · ${item.botId}` : copy.sessionMgmtSourceLocal;
  }

  function rowStateLabel(item: DesktopManagedSessionItem, copy: Translation): string {
    const stateLabel = item.state === "active" ? copy.sessionMgmtTabActive : item.state === "archived" ? copy.sessionMgmtTabArchived : copy.sessionMgmtTabTrash;
    return item.retain ? `${stateLabel} · ${copy.sessionMgmtRetain}` : stateLabel;
  }

  /** Web profile that owns the session's workspace; external/project branches
   * of the files API ignore it but require it non-empty. */
  function previewProfileId(item: DesktopManagedSessionItem): string {
    return item.source === "external" ? item.botId || "external" : item.botId || "default";
  }

  function openPreview(item: DesktopManagedSessionItem): void {
    previewFiles = [];
    revokePreviewMedia();
    previewMediaFailed = new Set();
    previewCopiedId = "";
    void openSessionPreview(endpoint, item);
    void loadPreviewFiles(item);
  }

  function closePreview(): void {
    closeSessionPreview();
    previewFiles = [];
    revokePreviewMedia();
  }

  function revokePreviewMedia(): void {
    for (const url of previewMediaUrls.values()) URL.revokeObjectURL(url);
    previewMediaUrls = new Map();
    previewMediaLoading = new Set();
  }

  async function loadPreviewFiles(item: DesktopManagedSessionItem): Promise<void> {
    try {
      const files = await listDesktopSessionFiles(
        endpoint,
        previewProfileId(item),
        item.conversationId,
        item.projectId || undefined
      );
      if (sessionManagementStore.previewItem?.conversationId !== item.conversationId) return;
      previewFiles = files;
    } catch {
      previewFiles = [];
    }
  }

  async function loadPreviewMedia(file: DesktopSessionFile): Promise<void> {
    const item = sessionManagementStore.previewItem;
    if (!endpoint || !item) return;
    if (previewMediaUrls.has(file.local) || previewMediaLoading.has(file.local)) return;
    const conversationId = item.conversationId;
    const loading = new Set(previewMediaLoading);
    loading.add(file.local);
    previewMediaLoading = loading;
    try {
      const blob = await fetchDesktopFileBlob(
        endpoint,
        previewProfileId(item),
        conversationId,
        file.id,
        false,
        item.projectId || undefined
      );
      // The dialog may have closed (URLs revoked) or switched conversations
      // while the fetch was in flight; a late URL would leak its blob.
      if (sessionManagementStore.previewItem?.conversationId !== conversationId) {
        URL.revokeObjectURL(URL.createObjectURL(blob));
        return;
      }
      const url = URL.createObjectURL(blob);
      const next = new Map(previewMediaUrls);
      next.set(file.local, url);
      previewMediaUrls = next;
    } catch {
      const failed = new Set(previewMediaFailed);
      failed.add(file.local);
      previewMediaFailed = failed;
    } finally {
      const done = new Set(previewMediaLoading);
      done.delete(file.local);
      previewMediaLoading = done;
    }
  }

  async function downloadPreviewFile(file: DesktopSessionFile): Promise<void> {
    const item = sessionManagementStore.previewItem;
    if (!endpoint || !item) return;
    try {
      const blob = await fetchDesktopFileBlob(
        endpoint,
        previewProfileId(item),
        item.conversationId,
        file.id,
        true,
        item.projectId || undefined
      );
      await saveBlobAsFile(blob, file.original);
    } catch (cause) {
      sessionManagementStore.previewError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const previewAttachmentActions = $derived({
    filesByLocal: previewFileByLocal,
    mediaUrls: previewMediaUrls,
    mediaLoading: previewMediaLoading,
    mediaFailed: previewMediaFailed,
    loadMedia: (file: DesktopSessionFile) => void loadPreviewMedia(file),
    canPreview: (file: DesktopSessionFile): boolean => file.mediaType === "image" || file.mediaType === "audio" || file.mediaType === "video",
    preview: (file: DesktopSessionFile) => void loadPreviewMedia(file),
    download: (file: DesktopSessionFile) => void downloadPreviewFile(file)
  } satisfies TranscriptAttachmentActions);

  async function copyPreviewMessage(message: TranscriptMessage): Promise<void> {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      previewCopiedId = message.id ?? "";
      if (previewCopiedTimer) clearTimeout(previewCopiedTimer);
      previewCopiedTimer = setTimeout(() => {
        previewCopiedId = "";
        previewCopiedTimer = null;
      }, 1500);
    } catch { /* clipboard unavailable */ }
  }

  const previewMessageActions = $derived(
    sessionManagementStore.previewMessages.length > 0
      ? {
          copiedId: previewCopiedId,
          onCopy: (message: TranscriptMessage) => void copyPreviewMessage(message)
        }
      : null
  );

  function formatPreviewTime(value: string): string {
    return formatMessageTime(value, session.text.groupYesterday);
  }

  function onRowClick(event: MouseEvent, item: DesktopManagedSessionItem, idx: number): void {
    if ((event.target as HTMLElement | null)?.closest?.("button,input,label,a")) return;
    toggleSessionRow(item.conversationId, idx, event.shiftKey);
  }

  function onRowKeydown(event: KeyboardEvent, item: DesktopManagedSessionItem, idx: number): void {
    if (event.key === " " && (event.target as HTMLElement)?.tagName !== "INPUT") {
      event.preventDefault();
      toggleSessionRow(item.conversationId, idx, event.shiftKey);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? Math.min(sessionManagementStore.items.length - 1, idx + 1) : Math.max(0, idx - 1);
      document.querySelector<HTMLElement>(`[data-session-row="${next}"]`)?.focus();
    }
  }
</script>

{#if !session.serviceReady || !endpoint}
  <div class="settings-card"><EmptyState title={session.text.sessionMgmtUnavailable} icon="clock-counter-clockwise" /></div>
{:else}
  <div class="settings-card" data-session-management="filters">
    <div class="settings-form">
      <div class="settings-field settings-field-wide" data-session-views>
        <nav class="memory-center-tabs" aria-label={session.text.sessionMgmtViews}>
          {#each viewTabs as tab (tab.id)}
            <button type="button" class:active={sessionManagementStore.view === tab.id} aria-current={sessionManagementStore.view === tab.id ? "page" : undefined} onclick={() => setSessionView(endpoint, tab.id)}>{tab.label} ({tab.count})</button>
          {/each}
        </nav>
      </div>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterBot}</span><input bind:value={sessionManagementStore.botIds} autocomplete="off" spellcheck="false" placeholder={session.text.sessionMgmtFilterBotPh} onchange={() => applySessionFilters(endpoint)} /></label>
      <div class="settings-field"><span>{session.text.sessionMgmtFilterSource}</span><SelectControl value={sessionManagementStore.source} ariaLabel={session.text.sessionMgmtFilterSource} options={sourceOptions} onChange={(value) => { sessionManagementStore.source = value; applySessionFilters(endpoint); }} /></div>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterKeyword}</span><input bind:value={sessionManagementStore.keyword} autocomplete="off" spellcheck="false" placeholder={session.text.sessionMgmtFilterKeywordPh} onchange={() => applySessionFilters(endpoint)} /></label>
      <div class="settings-field"><span>{session.text.sessionMgmtFilterInactive}</span><SelectControl value={sessionManagementStore.inactiveDays} ariaLabel={session.text.sessionMgmtFilterInactive} options={inactiveOptions} onChange={(value) => { sessionManagementStore.inactiveDays = value; applySessionFilters(endpoint); }} /></div>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterFrom}</span><input type="date" bind:value={sessionManagementStore.fromDate} onchange={() => applySessionFilters(endpoint)} /></label>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterTo}</span><input type="date" bind:value={sessionManagementStore.toDate} onchange={() => applySessionFilters(endpoint)} /></label>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterEmpty}</span><span class="inline-check"><input type="checkbox" bind:checked={sessionManagementStore.empty} onchange={() => applySessionFilters(endpoint)} /></span></label>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterShort}</span><span class="inline-check"><input type="checkbox" bind:checked={sessionManagementStore.short} onchange={() => applySessionFilters(endpoint)} /></span></label>
      <div class="settings-field"><span>{session.text.sessionMgmtFilterExtraction}</span><SelectControl value={sessionManagementStore.extractionFilter} ariaLabel={session.text.sessionMgmtFilterExtraction} options={extractionOptions} onChange={(value) => { sessionManagementStore.extractionFilter = value; applySessionFilters(endpoint); }} /></div>
      <label class="settings-field"><span>{session.text.sessionMgmtProcessedOnly}</span><span class="inline-check"><input type="checkbox" bind:checked={sessionManagementStore.processedOnly} onchange={() => applySessionFilters(endpoint)} /></span></label>
      <div class="settings-field settings-field-wide settings-row-actions">
        <button class="secondary-button" type="button" onclick={() => applySessionFilters(endpoint)}>{session.text.sessionMgmtApply}</button>
        <button class="secondary-button" type="button" onclick={() => resetSessionFilters(endpoint)}>{session.text.sessionMgmtReset}</button>
      </div>
    </div>
  </div>

  <div class="settings-card" data-session-management="list">
    <div class="settings-row">
      <div class="profile-info">
        <strong>{fill(session.text.sessionMgmtSelectedCount, { count: selCount })}</strong>
        <p>{consequenceText}</p>
        <p>{session.text.sessionMgmtConsequenceDelete}</p>
        <p>{session.text.sessionMgmtConsequenceExtract}</p>
        {#if sessionManagementStore.selectAll}<p>{fill(session.text.sessionMgmtSelectAllNote, { count: sessionManagementStore.selectAll.count })}</p>{/if}
      </div>
      <div class="settings-row-actions">
        <button class="secondary-button" type="button" disabled={sessionManagementStore.loading || sessionManagementStore.items.length === 0} onclick={() => toggleSessionPage(!allChecked)}>{session.text.sessionMgmtSelectPage}</button>
        <button class="secondary-button" type="button" disabled={sessionManagementStore.selectingAll || sessionManagementStore.loading || sessionManagementStore.total === 0} onclick={() => void selectAllMatchingSessions(endpoint)}>{session.text.sessionMgmtSelectAll}</button>
        {#if sessionManagementStore.view === "active"}
          <button class="primary-button" type="button" disabled={selCount === 0 || sessionManagementStore.bulkBusy} onclick={() => void runSessionBulk(endpoint, "archive")}>{session.text.sessionMgmtArchive}</button>
        {/if}
        {#if showRestore}
          <button class="primary-button" type="button" disabled={selCount === 0 || sessionManagementStore.bulkBusy} onclick={() => void runSessionBulk(endpoint, "restore")}>{session.text.sessionMgmtRestore}</button>
        {/if}
        <button class="secondary-button" type="button" disabled={selCount === 0 || sessionManagementStore.bulkBusy} onclick={() => void runSessionExtraction(endpoint)}>{session.text.sessionMgmtExtractArchive}</button>
        <button class="secondary-button danger-action" type="button" disabled={selCount === 0 || sessionManagementStore.bulkBusy} onclick={() => void requestSessionDelete(endpoint)}>{session.text.sessionMgmtDelete}</button>
        {#if sessionManagementStore.bulkFailed > 0 && sessionManagementStore.lastOperationId}
          <button class="secondary-button" type="button" disabled={sessionManagementStore.bulkBusy} onclick={() => void retrySessionBulk(endpoint)}>{session.text.sessionMgmtRetry}</button>
        {/if}
      </div>
    </div>

    {#if sessionManagementStore.bulkCounts}
      <p class="settings-action-message" aria-live="polite">{fill(session.text.sessionMgmtOpDone, { ok: sessionManagementStore.bulkCounts.succeeded, skip: sessionManagementStore.bulkCounts.skipped, fail: sessionManagementStore.bulkCounts.failed })}</p>
    {:else if sessionManagementStore.extractCounts}
      <p class="settings-action-message" aria-live="polite">{fill(session.text.sessionMgmtExtractDone, { archived: sessionManagementStore.extractCounts.archived, total: sessionManagementStore.extractCounts.total, fail: sessionManagementStore.extractCounts.failed })}</p>
    {/if}
    {#if sessionManagementStore.bulkError}<p class="error-message" role="alert">{sessionManagementStore.bulkError}</p>{/if}
    {#each sessionManagementStore.extractResults as result (result.conversationId)}
      <div class="settings-row">
        <div class="profile-info">
          <strong>{result.conversationId} · {sessionExtractionLabel(result.status)} · {result.archived ? session.text.sessionMgmtTabArchived : session.text.sessionMgmtExtractNotArchived}</strong>
          {#if result.archiveReason}<p>{result.archiveReason}</p>{/if}
          {#each result.failureReasons as reason}<p>{reason}</p>{/each}
        </div>
      </div>
    {/each}

    {#if sessionManagementStore.loading}
      <SkeletonRows count={4} label={session.text.loading} />
    {:else if sessionManagementStore.loadError}
      <div class="settings-row">
        <div class="profile-info"><strong>{session.text.sessionMgmtLoadFailed}</strong><p>{sessionManagementStore.loadError}</p></div>
        <div class="settings-row-actions"><button class="secondary-button" type="button" onclick={() => void loadManagedSessions(endpoint)}>{session.text.retryLoading}</button></div>
      </div>
    {:else if sessionManagementStore.items.length === 0}
      <EmptyState title={session.text.sessionMgmtNoItems} icon="magnifying-glass" />
    {:else}
      <div role="listbox" aria-multiselectable="true" aria-label={session.text.sessionMgmtViews}>
      {#each sessionManagementStore.items as item, idx (item.conversationId)}
        <div
          class="settings-row"
          data-session-row={idx}
          tabindex="0"
          role="option"
          aria-selected={item.conversationId in sessionManagementStore.selected || Boolean(sessionManagementStore.selectAll)}
          onclick={(event) => onRowClick(event, item, idx)}
          onkeydown={(event) => onRowKeydown(event, item, idx)}
        >
          <label class="inline-check">
            <input
              type="checkbox"
              checked={item.conversationId in sessionManagementStore.selected}
              onchange={(event) => toggleSessionRow(item.conversationId, idx, (event as unknown as MouseEvent).shiftKey)}
              onclick={(event) => event.stopPropagation()}
              aria-label={item.title || item.conversationId}
            />
          </label>
          <div class="profile-info">
            <strong>{item.title || item.conversationId}</strong>
            <p>{sourceLabel(item, session.text)} · {item.lastActivityAt ? formatNaturalDateTime(item.lastActivityAt, session.locale) : "—"} · {item.userTurnCount} {session.text.sessionMgmtColTurns}</p>
          </div>
          <div class="settings-row-actions">
            <StatusBadge label={rowStateLabel(item, session.text)} state={item.state === "active" ? "ready" : item.state === "archived" ? "warning" : "error"} />
            <StatusBadge label={sessionExtractionLabel(rowExtractionStatus(item))} state={rowExtractionStatus(item) === "failed" ? "error" : rowExtractionStatus(item) === "unprocessed" ? "disconnected" : "ready"} />
            <button class="secondary-button" type="button" onclick={() => openPreview(item)}>{session.text.sessionMgmtPreviewRow}</button>
          </div>
        </div>
      {/each}
      </div>
      <div class="observatory-pagination">
        <span>{fill(session.text.sessionMgmtPageOf, { page: pageIdx + 1, pages: pageCount, total: sessionManagementStore.total })}</span>
        <div>
          <button class="secondary-button" type="button" disabled={pageIdx === 0 || sessionManagementStore.loading} onclick={() => turnSessionPage(endpoint, -1)}>{session.text.sessionMgmtPrevPage}</button>
          <button class="secondary-button" type="button" disabled={pageIdx + 1 >= pageCount || sessionManagementStore.loading} onclick={() => turnSessionPage(endpoint, 1)}>{session.text.sessionMgmtNextPage}</button>
        </div>
      </div>
    {/if}
  </div>

  {#if sessionManagementStore.previewId}
    <Dialog
      open={Boolean(sessionManagementStore.previewId)}
      labelledBy="session-mgmt-preview-title"
      contentClass="session-preview-dialog"
      onOpenChange={(next) => { if (!next) closePreview(); }}
    >
      <header class="entity-editor-head">
        <div>
          <strong id="session-mgmt-preview-title">{sessionManagementStore.previewTitle || sessionManagementStore.previewId}</strong>
          <p>
            {session.text.sessionMgmtPreviewTitle}
            {#if sessionManagementStore.previewReadOnly} · {session.text.sessionMgmtPreviewReadOnly}{/if}
          </p>
        </div>
        <div class="settings-row-actions">
          <button class="secondary-button" type="button" onclick={closePreview}>{session.text.sessionMgmtPreviewClose}</button>
        </div>
      </header>
      <div class="session-preview-body">
        {#if sessionManagementStore.previewLoading}
          <SkeletonRows count={3} label={session.text.sessionMgmtPreviewLoading} />
        {:else if sessionManagementStore.previewUnavailable}
          <EmptyState title={session.text.sessionMgmtSourceUnavailable} icon="clock-counter-clockwise" />
        {:else if sessionManagementStore.previewError}
          <p class="error-message" role="alert">{sessionManagementStore.previewError}</p>
        {:else if sessionManagementStore.previewMessages.length === 0}
          <EmptyState title={session.text.sessionMgmtPreviewEmpty} icon="chat-circle-dots" />
        {:else}
          <div class="messages session-preview-messages">
            <ConversationTranscript
              messages={sessionManagementStore.previewMessages}
              copy={session.text}
              formatTime={formatPreviewTime}
              assistantName={session.text.appName}
              attachmentActions={previewAttachmentActions}
              messageActions={previewMessageActions}
              {endpoint}
            />
          </div>
        {/if}
        {#if sessionManagementStore.previewExtraction}
          <div class="session-preview-extraction">
            <strong>{session.text.sessionMgmtColExtraction} · {sessionExtractionLabel(sessionManagementStore.previewExtraction.status)}</strong>
            {#if sessionManagementStore.previewExtraction.processedThroughId || sessionManagementStore.previewExtraction.messageRevision}
              <p>{session.text.sessionMgmtExtractRange}: {sessionManagementStore.previewExtraction.processedThroughId ?? "—"}{sessionManagementStore.previewExtraction.messageRevision ? ` · ${sessionManagementStore.previewExtraction.messageRevision}` : ""}</p>
            {/if}
            {#if sessionManagementStore.previewExtraction.savedMemoryIds.length > 0 || sessionManagementStore.previewExtraction.savedDocRefs.length > 0}
              <p>{session.text.sessionMgmtExtractRetained}: {session.text.sessionMgmtExtractMemories} {sessionManagementStore.previewExtraction.savedMemoryIds.length} · {session.text.sessionMgmtExtractDocs} {sessionManagementStore.previewExtraction.savedDocRefs.length}</p>
            {/if}
            {#each sessionManagementStore.previewExtraction.savedDocRefs as doc (doc.docId)}<p>{doc.title ?? doc.docId} · {doc.docId}</p>{/each}
            {#if sessionManagementStore.previewExtraction.pendingCandidateIds.length > 0}<p>{session.text.sessionMgmtExtractPending}: {sessionManagementStore.previewExtraction.pendingCandidateIds.join(", ")}</p>{/if}
            {#each sessionManagementStore.previewExtraction.failureReasons as reason}<p>{session.text.sessionMgmtExtractFailures}: {reason}</p>{/each}
            <div class="settings-row-actions">
              <button class="secondary-button" type="button" onclick={() => { closePreview(); navigateSettings("memory"); }}>{session.text.sessionMgmtExtractViewMemory}</button>
            </div>
          </div>
        {/if}
      </div>
    </Dialog>
  {/if}

  <div class="settings-card" data-session-management="policy">
    <div class="settings-row">
      <div class="profile-info"><strong>{session.text.sessionMgmtPolicyTitle}</strong><p>{session.text.sessionMgmtPolicyDesc}</p></div>
    </div>
    {#if sessionManagementStore.policyLoading}
      <SkeletonRows count={2} label={session.text.loading} />
    {:else}
      {#if sessionManagementStore.policyError}<p class="error-message" role="alert">{sessionManagementStore.policyError}</p>{/if}
      {#if sessionManagementStore.policyMessage}<p class="settings-action-message" aria-live="polite">{sessionManagementStore.policyMessage}</p>{/if}
      <div class="settings-row">
        <div class="profile-info"><strong>{session.text.sessionMgmtPolicyEnabled}</strong></div>
        <IosSwitch checked={sessionManagementStore.policyEnabled} ariaLabel={session.text.sessionMgmtPolicyEnabled} onCheckedChange={(checked) => { sessionManagementStore.policyEnabled = checked; void refreshSessionPolicyPreview(endpoint); }} />
      </div>
      <div class="settings-row">
        <div class="profile-info"><strong>{session.text.sessionMgmtPolicyDays}</strong></div>
        <input class="row-input" type="number" min="1" step="1" bind:value={sessionManagementStore.policyDays} onchange={() => void refreshSessionPolicyPreview(endpoint)} aria-label={session.text.sessionMgmtPolicyDays} />
      </div>
      <div class="settings-row">
        <div class="profile-info">
          <p>{sessionManagementStore.policyPreview === null ? "" : fill(session.text.sessionMgmtPolicyPreview, { count: sessionManagementStore.policyPreview })}</p>
          <p>{sessionManagementStore.lastRun ? `${session.text.sessionMgmtPolicyLastRun}: ${sessionManagementStore.lastRun.finishedAt ?? sessionManagementStore.lastRun.startedAt}` : session.text.sessionMgmtPolicyNeverRun}</p>
        </div>
        <div class="settings-row-actions"><button class="secondary-button" type="button" disabled={sessionManagementStore.policyLoading} onclick={() => void refreshSessionPolicyPreview(endpoint)}>{session.text.sessionMgmtPolicyRefreshPreview}</button></div>
      </div>
      <div class="settings-row">
        <div class="profile-info"><strong>{session.text.sessionMgmtPolicyBots}</strong></div>
      </div>
      {#each Object.entries(sessionManagementStore.policyBots) as [botId, override] (botId)}
        <div class="settings-row">
          <div class="profile-info"><strong>{botId}</strong></div>
          <div class="settings-row-actions">
            <SelectControl value={override.mode} ariaLabel={`${botId} ${session.text.sessionMgmtPolicyMode}`} options={botModeOptions} onChange={(value) => { sessionManagementStore.policyBots = { ...sessionManagementStore.policyBots, [botId]: { ...override, mode: value as typeof override.mode } }; }} />
            {#if override.mode === "custom"}
              <input class="row-input" type="number" min="1" step="1" value={override.inactiveDays ?? sessionManagementStore.policyDays} onchange={(event) => { sessionManagementStore.policyBots = { ...sessionManagementStore.policyBots, [botId]: { ...override, inactiveDays: Math.floor(Number((event.currentTarget as HTMLInputElement).value)) } }; }} aria-label={`${botId} ${session.text.sessionMgmtPolicyDays}`} />
            {/if}
            <button class="secondary-button" type="button" disabled={sessionManagementStore.policySaving} onclick={() => void applySessionBotOverride(endpoint, botId, sessionManagementStore.policyBots[botId])}>{session.text.sessionMgmtBotApply}</button>
            <button class="secondary-button" type="button" disabled={sessionManagementStore.policySaving} onclick={() => void removeSessionBotOverride(endpoint, botId)}>{session.text.sessionMgmtBotRemove}</button>
          </div>
        </div>
      {/each}
      <div class="settings-row">
        <div class="settings-row-actions">
          <input class="row-input" bind:value={newBotId} autocomplete="off" spellcheck="false" placeholder={session.text.sessionMgmtPolicyBotId} aria-label={session.text.sessionMgmtPolicyBotId} />
          <SelectControl value={newBotMode} ariaLabel={session.text.sessionMgmtPolicyMode} options={botModeOptions} onChange={(value) => { newBotMode = value as "inherit" | "disabled" | "custom"; }} />
          {#if newBotMode === "custom"}
            <input class="row-input" type="number" min="1" step="1" bind:value={newBotDays} aria-label={session.text.sessionMgmtPolicyDays} />
          {/if}
          <button class="secondary-button" type="button" disabled={!newBotId.trim() || sessionManagementStore.policySaving} onclick={() => { void applySessionBotOverride(endpoint, newBotId, newBotMode === "custom" ? { mode: newBotMode, inactiveDays: Math.max(1, Math.floor(newBotDays) || 1) } : { mode: newBotMode }).then(() => { newBotId = ""; }); }}>{session.text.sessionMgmtBotApply}</button>
        </div>
      </div>
    {/if}
  </div>

  <footer class="settings-footbar">
    <span class="settings-footbar-label">{sessionManagementStore.policySaving ? session.text.loading : sessionManagementStore.policyMessage || sessionManagementStore.policyError}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={sessionManagementStore.policyLoading || sessionManagementStore.policySaving || !endpoint} onclick={() => void loadSessionPolicy(endpoint)}>{session.text.sessionMgmtReset}</button>
      <button class="primary-button" type="button" disabled={sessionManagementStore.policyLoading || sessionManagementStore.policySaving || !endpoint} onclick={() => void saveSessionPolicy(endpoint)}>{sessionManagementStore.policySaving ? session.text.loading : session.text.save}</button>
    </div>
  </footer>

  {#if sessionManagementStore.confirmDelete && sessionManagementStore.deleteFacts}
    <Dialog
      open={sessionManagementStore.confirmDelete}
      busy={sessionManagementStore.bulkBusy}
      labelledBy="session-mgmt-delete-title"
      describedBy="session-mgmt-delete-scope"
      onOpenChange={(next) => { if (!next) cancelSessionDelete(); }}
    >
      <header class="entity-editor-head"><div><strong id="session-mgmt-delete-title">{session.text.sessionMgmtDeleteTitle}</strong></div></header>
      <div class="modal-body settings-form">
        <div class="settings-field settings-field-wide">
          <p>{fill(session.text.sessionMgmtDeleteCount, { count: sessionManagementStore.deleteFacts.count })}</p>
          <p>{sessionManagementStore.view === "trashed" ? session.text.sessionMgmtDeletePermanent : fill(session.text.sessionMgmtDeleteRecovery, { days: sessionManagementStore.deleteFacts.retentionDays })}</p>
          <p id="session-mgmt-delete-scope">{session.text.sessionMgmtDeleteScope}</p>
        </div>
      </div>
      <footer class="entity-editor-foot">
        <button class="secondary-button" type="button" onclick={cancelSessionDelete}>{session.text.cancel}</button>
        <button class="primary-button danger-action" type="button" disabled={sessionManagementStore.bulkBusy} onclick={() => void runSessionBulk(endpoint, "delete")}>{session.text.sessionMgmtDeleteConfirm}</button>
      </footer>
    </Dialog>
  {/if}
{/if}
