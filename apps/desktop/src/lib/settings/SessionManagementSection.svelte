<script lang="ts">
  import { untrack } from "svelte";
  import Refresh from "reicon-svelte/icons/Refresh";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import type { DesktopExtractionStatus, DesktopManagedSessionItem, DesktopManagedViewState } from "../api";
  import type { DesktopSessionFile } from "@molibot/desktop-contract";
  import {
    desktopFileContentUrl,
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
    toggleSessionOne,
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

  let filtersOpen = $state(false);
  let policyOpen = $state(false);
  let policyEndpoint = "";
  const advancedFilterCount = $derived([
    Boolean(sessionManagementStore.botIds.trim()), sessionManagementStore.inactiveDays !== "any",
    Boolean(sessionManagementStore.fromDate), Boolean(sessionManagementStore.toDate),
    sessionManagementStore.empty, sessionManagementStore.short,
    sessionManagementStore.extractionFilter !== "any", sessionManagementStore.processedOnly
  ].filter(Boolean).length);
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
  const allChecked = $derived(Boolean(sessionManagementStore.selectAll) || (pageIds.length > 0 && pageIds.every((id) => id in sessionManagementStore.selected)));
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
    if (readyEndpoint) untrack(() => void loadManagedSessions(readyEndpoint));
  });

  $effect(() => {
    if (policyOpen && endpoint && policyEndpoint !== endpoint) {
      policyEndpoint = endpoint;
      untrack(() => void loadSessionPolicy(endpoint));
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
    for (const url of previewMediaUrls.values()) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
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
    if (previewMediaLoading.has(file.local)) return;
    const next = new Map(previewMediaUrls);
    next.set(
      file.local,
      desktopFileContentUrl(
        endpoint,
        previewProfileId(item),
        item.conversationId,
        file.id,
        false,
        item.projectId || undefined,
        Date.now()
      )
    );
    previewMediaUrls = next;
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

  const resolvedPreviewMediaUrls = $derived.by(() => {
    const item = sessionManagementStore.previewItem;
    if (!endpoint || !item) return previewMediaUrls;
    const profileId = previewProfileId(item);
    return new Map([
      ...previewFiles
        .filter((file) => file.mediaType === "image" || file.mediaType === "audio" || file.mediaType === "video")
        .map((file): [string, string] => [
          file.local,
          desktopFileContentUrl(endpoint, profileId, item.conversationId, file.id, false, item.projectId || undefined)
        ]),
      ...previewMediaUrls
    ]);
  });

  const previewAttachmentActions = $derived({
    filesByLocal: previewFileByLocal,
    mediaUrls: resolvedPreviewMediaUrls,
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

  function onRowCheck(event: Event, item: DesktopManagedSessionItem, idx: number): void {
    toggleSessionOne(item.conversationId, item.version, (event.currentTarget as HTMLInputElement).checked);
    sessionManagementStore.lastSelectedIdx = idx;
  }

  function onRowClick(event: MouseEvent, item: DesktopManagedSessionItem, idx: number): void {
    if ((event.target as HTMLElement | null)?.closest?.("button,input,label,a")) return;
    toggleSessionRow(item.conversationId, idx, event.shiftKey);
  }

  function onRowKeydown(event: KeyboardEvent, item: DesktopManagedSessionItem, idx: number): void {
    if (event.target !== event.currentTarget) return;
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
  <div class="session-manager-shell">
  <div class="session-manager-heading">
    <nav class="memory-center-tabs session-manager-tabs" aria-label={session.text.sessionMgmtViews}>
      {#each viewTabs as tab (tab.id)}
        <button type="button" class:active={sessionManagementStore.view === tab.id} aria-current={sessionManagementStore.view === tab.id ? "page" : undefined} disabled={sessionManagementStore.bulkBusy || sessionManagementStore.selectingAll} onclick={() => setSessionView(endpoint, tab.id)}>{tab.label} <span>{tab.count}</span></button>
      {/each}
    </nav>
    <button class="icon-button" type="button" aria-label={session.text.sessionMgmtRefresh} title={session.text.sessionMgmtRefresh} disabled={sessionManagementStore.loading || sessionManagementStore.bulkBusy || sessionManagementStore.selectingAll} onclick={() => void loadManagedSessions(endpoint)}><Refresh size={16} aria-hidden="true" /></button>
  </div>
  <form class="session-manager-search" onsubmit={event => { event.preventDefault(); applySessionFilters(endpoint); }}>
    <label class="search-field"><Magnifier size={16} aria-hidden="true" /><input type="search" aria-label={session.text.sessionMgmtFilterKeyword} bind:value={sessionManagementStore.keyword} autocomplete="off" spellcheck="false" placeholder={session.text.sessionMgmtFilterKeywordPh} /></label>
    <SelectControl value={sessionManagementStore.source} ariaLabel={session.text.sessionMgmtFilterSource} options={sourceOptions} onChange={value => { sessionManagementStore.source = value; applySessionFilters(endpoint); }} />
    <button class="secondary-button" type="submit">{session.text.sessionMgmtApply}</button>
  </form>
  <div class="session-manager-filter-actions">
    <button class="text-button" type="button" aria-expanded={filtersOpen} aria-controls="session-manager-advanced" onclick={() => filtersOpen = !filtersOpen}>{session.text.sessionMgmtMoreFilters}{#if advancedFilterCount} <span class="tnum">{advancedFilterCount}</span>{/if}</button>
    {#if advancedFilterCount || sessionManagementStore.keyword || sessionManagementStore.source !== "all"}<button class="text-button" type="button" onclick={() => resetSessionFilters(endpoint)}>{session.text.sessionMgmtReset}</button>{/if}
  </div>
  {#if filtersOpen}
    <div class="settings-card" id="session-manager-advanced" data-session-management="filters">
      <div class="settings-form">
      <label class="settings-field"><span>{session.text.sessionMgmtFilterBot}</span><input bind:value={sessionManagementStore.botIds} autocomplete="off" spellcheck="false" placeholder={session.text.sessionMgmtFilterBotPh} onchange={() => applySessionFilters(endpoint)} /></label>
      <div class="settings-field"><span>{session.text.sessionMgmtFilterInactive}</span><SelectControl value={sessionManagementStore.inactiveDays} ariaLabel={session.text.sessionMgmtFilterInactive} options={inactiveOptions} onChange={(value) => { sessionManagementStore.inactiveDays = value; applySessionFilters(endpoint); }} /></div>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterFrom}</span><input type="date" bind:value={sessionManagementStore.fromDate} onchange={() => applySessionFilters(endpoint)} /></label>
      <label class="settings-field"><span>{session.text.sessionMgmtFilterTo}</span><input type="date" bind:value={sessionManagementStore.toDate} onchange={() => applySessionFilters(endpoint)} /></label>
      <div class="session-manager-toggle"><span>{session.text.sessionMgmtFilterEmpty}</span><IosSwitch checked={sessionManagementStore.empty} ariaLabel={session.text.sessionMgmtFilterEmpty} onCheckedChange={checked => { sessionManagementStore.empty = checked; applySessionFilters(endpoint); }} /></div>
      <div class="session-manager-toggle"><span>{session.text.sessionMgmtFilterShort}</span><IosSwitch checked={sessionManagementStore.short} ariaLabel={session.text.sessionMgmtFilterShort} onCheckedChange={checked => { sessionManagementStore.short = checked; applySessionFilters(endpoint); }} /></div>
      <div class="settings-field"><span>{session.text.sessionMgmtFilterExtraction}</span><SelectControl value={sessionManagementStore.extractionFilter} ariaLabel={session.text.sessionMgmtFilterExtraction} options={extractionOptions} onChange={(value) => { sessionManagementStore.extractionFilter = value; applySessionFilters(endpoint); }} /></div>
      <div class="session-manager-toggle"><span>{session.text.sessionMgmtProcessedOnly}</span><IosSwitch checked={sessionManagementStore.processedOnly} ariaLabel={session.text.sessionMgmtProcessedOnly} onCheckedChange={checked => { sessionManagementStore.processedOnly = checked; applySessionFilters(endpoint); }} /></div>
      </div>
    </div>
  {/if}

  <div class="settings-card" data-session-management="list">
    <div class="session-manager-selection" aria-label={session.text.sessionMgmtSelection}>
      <span>{fill(session.text.sessionMgmtSelectedCount, { count: selCount })}</span>
      <div class="settings-row-actions">
        <button class="text-button" type="button" disabled={sessionManagementStore.loading || sessionManagementStore.bulkBusy || sessionManagementStore.items.length === 0} onclick={() => toggleSessionPage(!allChecked)}>{session.text.sessionMgmtSelectPage}</button>
        <button class="text-button" type="button" disabled={sessionManagementStore.selectingAll || sessionManagementStore.bulkBusy || sessionManagementStore.loading || sessionManagementStore.total === 0} onclick={() => void selectAllMatchingSessions(endpoint)}>{session.text.sessionMgmtSelectAll}</button>
      </div>
    </div>
    {#if selCount > 0}
      <div class="session-manager-bulk">
        <div class="settings-row-actions">
          {#if sessionManagementStore.view === "active"}<button class="primary-button" type="button" disabled={sessionManagementStore.loading || sessionManagementStore.bulkBusy} onclick={() => void runSessionBulk(endpoint, "archive")}>{session.text.sessionMgmtArchive}</button>{/if}
          {#if showRestore}<button class="primary-button" type="button" disabled={sessionManagementStore.loading || sessionManagementStore.bulkBusy} onclick={() => void runSessionBulk(endpoint, "restore")}>{session.text.sessionMgmtRestore}</button>{/if}
          <button class="secondary-button" type="button" disabled={sessionManagementStore.loading || sessionManagementStore.bulkBusy} onclick={() => void runSessionExtraction(endpoint)}>{session.text.sessionMgmtExtractArchive}</button>
          <button class="secondary-button danger-action" type="button" disabled={sessionManagementStore.loading || sessionManagementStore.bulkBusy} onclick={() => void requestSessionDelete(endpoint)}>{sessionManagementStore.view === "trashed" ? session.text.sessionMgmtDeletePermanently : session.text.sessionMgmtDelete}</button>
        </div>
        <details class="session-manager-help"><summary>{session.text.sessionMgmtActionDetails}</summary><p>{consequenceText}</p><p>{sessionManagementStore.view === "trashed" ? session.text.sessionMgmtDeletePermanent : session.text.sessionMgmtConsequenceDelete}</p><p>{session.text.sessionMgmtConsequenceExtract}</p></details>
        {#if sessionManagementStore.selectAll}<p class="session-manager-note">{fill(session.text.sessionMgmtSelectAllNote, { count: sessionManagementStore.selectAll.count })}</p>{/if}
      </div>
    {/if}
    {#if sessionManagementStore.bulkFailed > 0 && sessionManagementStore.lastOperationId}<div class="session-manager-bulk"><button class="secondary-button" type="button" disabled={sessionManagementStore.bulkBusy} onclick={() => void retrySessionBulk(endpoint)}>{session.text.sessionMgmtRetry}</button></div>{/if}

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
          class="settings-row session-manager-row"
          class:selected={item.conversationId in sessionManagementStore.selected || Boolean(sessionManagementStore.selectAll)}
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
              checked={item.conversationId in sessionManagementStore.selected || Boolean(sessionManagementStore.selectAll)}
              onchange={(event) => onRowCheck(event, item, idx)}
              onclick={(event) => event.stopPropagation()}
              aria-label={item.title || item.conversationId}
            />
          </label>
          <div class="profile-info">
            <strong>{item.title || item.conversationId}</strong>
            <p class="session-manager-row-meta"><span>{sourceLabel(item, session.text)}</span><time datetime={item.lastActivityAt || undefined}>{item.lastActivityAt ? formatNaturalDateTime(item.lastActivityAt, session.locale) : "—"}</time><span>{item.userTurnCount} {session.text.sessionMgmtColTurns}</span></p>
          </div>
          <div class="settings-row-actions">
            {#if item.retain}<span class="session-manager-note">{session.text.sessionMgmtRetain}</span>{/if}
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

  <details class="session-manager-policy" bind:open={policyOpen}>
    <summary><span>{session.text.sessionMgmtPolicyTitle}</span><span class="session-manager-note">{session.text.sessionMgmtPolicyManage}</span></summary>
  {#if policyOpen}
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

  {/if}
  </details>
  {#if policyOpen}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{sessionManagementStore.policySaving ? session.text.loading : sessionManagementStore.policyMessage || sessionManagementStore.policyError || session.text.sessionMgmtPolicyTitle}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={sessionManagementStore.policyLoading || sessionManagementStore.policySaving || !endpoint} onclick={() => void loadSessionPolicy(endpoint)}>{session.text.sessionMgmtReset}</button>
      <button class="primary-button" type="button" disabled={sessionManagementStore.policyLoading || sessionManagementStore.policySaving || !endpoint} onclick={() => void saveSessionPolicy(endpoint)}>{sessionManagementStore.policySaving ? session.text.loading : session.text.save}</button>
    </div>
  </footer>
  {/if}

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
  </div>
{/if}
