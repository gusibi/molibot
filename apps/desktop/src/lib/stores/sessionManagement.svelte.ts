// Session management — state + orchestration over the shared managed-session
// HTTP contract. All lifecycle mutations go through the service; nothing here
// fabricates local state.
import {
  createDesktopManagedSelection,
  deleteDesktopSessionAutoArchiveBot,
  describeDesktopDelete,
  executeDesktopManagedBulk,
  executeDesktopManagedExtraction,
  loadDesktopManagedPreview,
  loadDesktopManagedSessions,
  loadDesktopExtractionStatus,
  loadDesktopSessionAutoArchive,
  previewDesktopSessionAutoArchive,
  retryDesktopManagedBulk,
  saveDesktopSessionAutoArchiveBot,
  saveDesktopSessionAutoArchiveGlobal,
  type DesktopBulkTarget,
  type DesktopExtractionDetail,
  type DesktopExtractionItemResult,
  type DesktopManagedPreviewMessage,
  type DesktopManagedSessionCounts,
  type DesktopManagedSessionItem,
  type DesktopManagedViewState,
  type DesktopSessionAutoArchiveBotPolicy,
  type DesktopSessionAutoArchiveLastRun
} from "../api";
import { session } from "./session.svelte";

const PAGE_SIZE = 20;
const SELECT_ALL_PAGE = 100;

export const sessionManagementStore = $state({
  endpoint: "",
  view: "active" as DesktopManagedViewState,
  botIds: "",
  source: "all",
  keyword: "",
  inactiveDays: "any",
  fromDate: "",
  toDate: "",
  empty: false,
  short: false,
  extractionFilter: "any",
  processedOnly: false,
  pageOffset: 0,
  items: [] as DesktopManagedSessionItem[],
  total: 0,
  counts: { active: 0, archived: 0, trashed: 0 } as DesktopManagedSessionCounts,
  loading: false,
  loadError: "",
  selected: {} as Record<string, number>,
  selectAll: null as { selectionId: string; count: number } | null,
  lastSelectedIdx: -1,
  selectingAll: false,
  previewId: "",
  previewItem: null as DesktopManagedSessionItem | null,
  previewTitle: "",
  previewReadOnly: false,
  previewMessages: [] as DesktopManagedPreviewMessage[],
  previewLoading: false,
  previewError: "",
  previewUnavailable: false,
  previewExtraction: null as DesktopExtractionDetail | null,
  bulkBusy: false,
  bulkError: "",
  bulkCounts: null as { total: number; succeeded: number; skipped: number; failed: number } | null,
  extractCounts: null as { total: number; archived: number; failed: number } | null,
  extractResults: [] as DesktopExtractionItemResult[],
  bulkFailed: 0,
  lastOperationId: "",
  confirmDelete: false,
  deleteFacts: null as { count: number; retentionDays: number } | null,
  extractingIds: {} as Record<string, true>,
  policyEnabled: false,
  policyDays: 30,
  policyBots: {} as Record<string, DesktopSessionAutoArchiveBotPolicy>,
  policyPreview: null as number | null,
  lastRun: null as DesktopSessionAutoArchiveLastRun | null,
  policyLoading: false,
  policySaving: false,
  policyError: "",
  policyMessage: "",
  listGeneration: 0,
  policyGeneration: 0
});

export function sessionManagementSelectedCount(): number {
  return sessionManagementStore.selectAll?.count ?? Object.keys(sessionManagementStore.selected).length;
}

function buildListQuery(offset: number, limit = PAGE_SIZE) {
  const store = sessionManagementStore;
  return {
    state: store.view,
    botIds: store.botIds,
    sources: store.source !== "all" ? store.source : undefined,
    keyword: store.keyword,
    inactiveDays: store.inactiveDays !== "any" ? store.inactiveDays : undefined,
    activityFromDate: store.fromDate,
    activityToDate: store.toDate,
    lengths: [store.empty ? "empty" : "", store.short ? "short" : ""].filter(Boolean).join(","),
    extractionState: store.extractionFilter !== "any" ? store.extractionFilter : undefined,
    processedNotArchived: store.processedOnly,
    limit,
    offset
  };
}

function clearSelection(): void {
  sessionManagementStore.selected = {};
  sessionManagementStore.selectAll = null;
  sessionManagementStore.lastSelectedIdx = -1;
}

export async function loadManagedSessions(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  const generation = ++store.listGeneration;
  store.endpoint = endpoint;
  store.loading = true;
  store.loadError = "";
  try {
    const result = await loadDesktopManagedSessions(endpoint, buildListQuery(store.pageOffset));
    if (generation !== store.listGeneration) return;
    store.items = result.items;
    store.total = result.total;
    store.counts = result.counts;
  } catch (cause) {
    if (generation !== store.listGeneration) return;
    store.loadError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (generation === store.listGeneration) store.loading = false;
  }
}

/** Filter/view changes clear the selection and restart from the first page. */
export function applySessionFilters(endpoint: string): void {
  sessionManagementStore.pageOffset = 0;
  sessionManagementStore.bulkError = "";
  sessionManagementStore.bulkCounts = null;
  sessionManagementStore.extractCounts = null;
  sessionManagementStore.extractResults = [];
  clearSelection();
  void loadManagedSessions(endpoint);
}

export function setSessionView(endpoint: string, view: DesktopManagedViewState): void {
  const store = sessionManagementStore;
  if (store.view === view) return;
  store.view = view;
  store.previewId = "";
  store.previewItem = null;
  store.previewReadOnly = false;
  store.previewMessages = [];
  store.previewError = "";
  store.previewExtraction = null;
  applySessionFilters(endpoint);
}

export function resetSessionFilters(endpoint: string): void {
  const store = sessionManagementStore;
  store.botIds = "";
  store.source = "all";
  store.keyword = "";
  store.inactiveDays = "any";
  store.fromDate = "";
  store.toDate = "";
  store.empty = false;
  store.short = false;
  store.extractionFilter = "any";
  store.processedOnly = false;
  applySessionFilters(endpoint);
}

export function turnSessionPage(endpoint: string, direction: 1 | -1): void {
  const store = sessionManagementStore;
  const page = Math.max(0, store.pageOffset / PAGE_SIZE + direction);
  store.pageOffset = page * PAGE_SIZE;
  clearSelection();
  void loadManagedSessions(endpoint);
}

export function toggleSessionOne(conversationId: string, version: number, checked: boolean): void {
  const store = sessionManagementStore;
  store.selectAll = null;
  const next = { ...store.selected };
  if (checked) next[conversationId] = version;
  else delete next[conversationId];
  store.selected = next;
}

export function toggleSessionPage(checked: boolean): void {
  const store = sessionManagementStore;
  store.selectAll = null;
  const next = { ...store.selected };
  for (const item of store.items) {
    if (checked) next[item.conversationId] = item.version;
    else delete next[item.conversationId];
  }
  store.selected = next;
}

/** Row click selection; `shift` extends the range from the last clicked row. */
export function toggleSessionRow(conversationId: string, idx: number, shift: boolean): void {
  const store = sessionManagementStore;
  const item = store.items[idx];
  if (!item) return;
  if (shift && store.lastSelectedIdx >= 0) {
    const [from, to] = [Math.min(store.lastSelectedIdx, idx), Math.max(store.lastSelectedIdx, idx)];
    const targetChecked = !(item.conversationId in store.selected);
    const next = { ...store.selected };
    for (let i = from; i <= to; i += 1) {
      if (targetChecked) next[store.items[i].conversationId] = store.items[i].version;
      else delete next[store.items[i].conversationId];
    }
    store.selected = next;
    store.selectAll = null;
  } else {
    toggleSessionOne(conversationId, item.version, !(conversationId in store.selected));
  }
  store.lastSelectedIdx = idx;
}

/** Cross-page selection: snapshot every matching id server-side via a selection. */
export async function selectAllMatchingSessions(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  store.selectingAll = true;
  store.bulkError = "";
  try {
    const ids: string[] = [];
    let offset = 0;
    for (;;) {
      const result = await loadDesktopManagedSessions(endpoint, buildListQuery(offset, SELECT_ALL_PAGE));
      for (const item of result.items) ids.push(item.conversationId);
      offset += result.items.length;
      if (offset >= result.total || result.items.length === 0) break;
    }
    const snapshot = await createDesktopManagedSelection(endpoint, ids);
    store.selected = {};
    store.selectAll = { selectionId: snapshot.selectionId, count: snapshot.count };
  } catch (cause) {
    store.bulkError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    store.selectingAll = false;
  }
}

/** Opens the modal preview; `item` carries the source context the transcript
 * needs to resolve attachment bytes (botId = web profile, projectId, source). */
export async function openSessionPreview(endpoint: string, item: DesktopManagedSessionItem): Promise<void> {
  const store = sessionManagementStore;
  store.previewId = item.conversationId;
  store.previewItem = item;
  store.previewTitle = "";
  store.previewReadOnly = false;
  store.previewMessages = [];
  store.previewError = "";
  store.previewUnavailable = false;
  store.previewExtraction = null;
  store.previewLoading = true;
  try {
    const preview = await loadDesktopManagedPreview(endpoint, item.conversationId);
    store.previewTitle = preview.title;
    store.previewReadOnly = preview.readOnly === true;
    store.previewMessages = preview.messages;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    store.previewUnavailable = message.includes("source-unavailable");
    store.previewError = message;
  } finally {
    store.previewLoading = false;
  }
  try {
    store.previewExtraction = await loadDesktopExtractionStatus(endpoint, item.conversationId);
  } catch {
    store.previewExtraction = null;
  }
}

export function closeSessionPreview(): void {
  const store = sessionManagementStore;
  store.previewId = "";
  store.previewItem = null;
  store.previewTitle = "";
  store.previewReadOnly = false;
  store.previewMessages = [];
  store.previewError = "";
  store.previewUnavailable = false;
  store.previewExtraction = null;
}

function selectionPayload(): { targets?: DesktopBulkTarget[]; selectionId?: string } {
  const store = sessionManagementStore;
  if (store.selectAll) return { selectionId: store.selectAll.selectionId };
  return {
    targets: Object.entries(store.selected).map(([conversationId, expectedVersion]) => ({ conversationId, expectedVersion }))
  };
}

/** Delete goes through the confirmation dialog first (`requestSessionDelete`).
 * In the trash view "delete" means permanent removal, so it executes the
 * explicit `purge` kind; everywhere else it is the recoverable trash move. */
export async function runSessionBulk(endpoint: string, kind: "archive" | "restore" | "delete"): Promise<void> {
  const store = sessionManagementStore;
  if (sessionManagementSelectedCount() === 0 || store.bulkBusy) return;
  if (kind === "delete" && !store.confirmDelete) return;
  const serverKind = kind === "delete" && store.view === "trashed" ? "purge" : kind;
  store.bulkBusy = true;
  store.bulkError = "";
  store.bulkCounts = null;
  store.extractCounts = null;
  store.extractResults = [];
  try {
    const result = await executeDesktopManagedBulk(endpoint, {
      kind: serverKind,
      ...selectionPayload(),
      idempotencyKey: crypto.randomUUID()
    });
    store.lastOperationId = result.operationId;
    store.bulkFailed = result.counts.failed;
    store.bulkCounts = result.counts;
    store.confirmDelete = false;
    store.deleteFacts = null;
    clearSelection();
    await loadManagedSessions(endpoint);
  } catch (cause) {
    store.bulkError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    store.bulkBusy = false;
  }
}

export async function requestSessionDelete(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  if (sessionManagementSelectedCount() === 0 || store.bulkBusy) return;
  store.bulkError = "";
  try {
    const facts = await describeDesktopDelete(endpoint, sessionManagementSelectedCount());
    store.deleteFacts = { count: facts.count, retentionDays: facts.retentionDays };
    store.confirmDelete = true;
  } catch (cause) {
    store.bulkError = cause instanceof Error ? cause.message : String(cause);
  }
}

export function cancelSessionDelete(): void {
  sessionManagementStore.confirmDelete = false;
  sessionManagementStore.deleteFacts = null;
}

export async function retrySessionBulk(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  if (!store.lastOperationId || store.bulkBusy) return;
  store.bulkBusy = true;
  store.bulkError = "";
  try {
    const result = await retryDesktopManagedBulk(endpoint, store.lastOperationId);
    store.bulkFailed = result.counts.failed;
    store.bulkCounts = result.counts;
    await loadManagedSessions(endpoint);
  } catch (cause) {
    store.bulkError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    store.bulkBusy = false;
  }
}

export async function runSessionExtraction(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  if (sessionManagementSelectedCount() === 0 || store.bulkBusy) return;
  store.bulkBusy = true;
  store.bulkError = "";
  store.bulkCounts = null;
  store.extractCounts = null;
  store.extractResults = [];
  const targetIds = store.selectAll ? [] : Object.keys(store.selected);
  if (!store.selectAll) {
    const next: Record<string, true> = {};
    for (const id of targetIds) next[id] = true;
    store.extractingIds = next;
  }
  try {
    const result = await executeDesktopManagedExtraction(endpoint, {
      mode: "extract-and-archive",
      ...selectionPayload(),
      idempotencyKey: crypto.randomUUID()
    });
    store.extractResults = result.items;
    store.bulkFailed = result.counts.failed;
    store.extractCounts = result.counts;
    store.confirmDelete = false;
    store.deleteFacts = null;
    clearSelection();
    await loadManagedSessions(endpoint);
  } catch (cause) {
    store.bulkError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    store.extractingIds = {};
    store.bulkBusy = false;
  }
}

export function sessionExtractionLabel(status: string): string {
  switch (status) {
    case "processing": return session.text.sessionMgmtStProcessing;
    case "saved": return session.text.sessionMgmtStSaved;
    case "no-useful-information": return session.text.sessionMgmtStNoUseful;
    case "pending-review": return session.text.sessionMgmtStPending;
    case "partially-processed": return session.text.sessionMgmtStPartial;
    case "failed": return session.text.sessionMgmtStFailed;
    default: return session.text.sessionMgmtStUnprocessed;
  }
}

export async function loadSessionPolicy(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  const generation = ++store.policyGeneration;
  store.policyLoading = true;
  store.policyError = "";
  store.endpoint = endpoint;
  try {
    const overview = await loadDesktopSessionAutoArchive(endpoint);
    if (generation !== store.policyGeneration) return;
    store.policyEnabled = overview.policy.enabled;
    store.policyDays = overview.policy.inactiveDays;
    store.policyBots = overview.policy.bots;
    store.policyPreview = overview.previewCount;
    store.lastRun = overview.lastRun;
    store.policyMessage = "";
  } catch (cause) {
    if (generation !== store.policyGeneration) return;
    store.policyError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (generation === store.policyGeneration) store.policyLoading = false;
  }
}

export async function refreshSessionPolicyPreview(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  store.policyError = "";
  try {
    store.policyPreview = await previewDesktopSessionAutoArchive(endpoint, {
      enabled: store.policyEnabled,
      inactiveDays: store.policyDays,
      bots: store.policyBots
    });
  } catch (cause) {
    store.policyError = cause instanceof Error ? cause.message : String(cause);
  }
}

export async function saveSessionPolicy(endpoint: string): Promise<void> {
  const store = sessionManagementStore;
  store.policySaving = true;
  store.policyError = "";
  store.policyMessage = "";
  try {
    const overview = await saveDesktopSessionAutoArchiveGlobal(endpoint, {
      enabled: store.policyEnabled,
      inactiveDays: Math.max(1, Math.floor(store.policyDays) || 1)
    });
    store.policyPreview = overview.previewCount;
    store.lastRun = overview.lastRun;
    store.policyMessage = session.text.sessionMgmtPolicySaved;
  } catch (cause) {
    store.policyError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    store.policySaving = false;
  }
}

export async function applySessionBotOverride(endpoint: string, botId: string, policy: DesktopSessionAutoArchiveBotPolicy): Promise<void> {
  const store = sessionManagementStore;
  if (!botId.trim() || store.policySaving) return;
  store.policySaving = true;
  store.policyError = "";
  store.policyMessage = "";
  try {
    const overview = await saveDesktopSessionAutoArchiveBot(endpoint, botId.trim(), policy);
    store.policyBots = overview.policy.bots;
    store.policyPreview = overview.previewCount;
    store.policyMessage = session.text.sessionMgmtPolicySaved;
  } catch (cause) {
    store.policyError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    store.policySaving = false;
  }
}

export async function removeSessionBotOverride(endpoint: string, botId: string): Promise<void> {
  const store = sessionManagementStore;
  if (store.policySaving) return;
  store.policySaving = true;
  store.policyError = "";
  store.policyMessage = "";
  try {
    const overview = await deleteDesktopSessionAutoArchiveBot(endpoint, botId);
    store.policyBots = overview.policy.bots;
    store.policyPreview = overview.previewCount;
  } catch (cause) {
    store.policyError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    store.policySaving = false;
  }
}

export const SESSION_MANAGEMENT_PAGE_SIZE = PAGE_SIZE;
