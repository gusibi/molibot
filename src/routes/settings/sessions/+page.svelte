<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Switch } from "$lib/components/ui/switch";
  import { Tabs, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { locale, type LocaleKey } from "$lib/ui/i18n";

  type View = "active" | "archived" | "trashed";

  interface ManagedItem {
    conversationId: string;
    title: string;
    source: string;
    channel: string;
    botId: string;
    projectId?: string;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string | null;
    userTurnCount: number;
    assistantTurnCount: number;
    state: View;
    version: number;
    retain: boolean;
    extractionStatus: string;
    extractionRevision: string | null;
    processedThroughId: string | null;
    savedMemoryIds: string[];
    savedDocRefs: Array<{ docId: string; title?: string }>;
    pendingCandidateIds: string[];
  }

  interface ExtractionDetail {
    status: string;
    messageRevision: string | null;
    processedThroughId: string | null;
    savedMemoryIds: string[];
    savedDocRefs: Array<{ docId: string; title?: string }>;
    pendingCandidateIds: string[];
    failureReasons: string[];
  }

  interface ExtractItemResult {
    conversationId: string;
    status: string;
    archived: boolean;
    archiveReason?: string;
    messageRevision: string;
    processedThroughId: string | null;
    failureReasons: string[];
  }

  interface PreviewMessage {
    role: string;
    content: string;
    createdAt: string;
  }

  const COPY: Record<LocaleKey, Record<string, string>> = {
    "zh-CN": {
      eyebrow: "会话管理",
      title: "会话管理",
      desc: "搜索、筛选、预览并批量归档或删除你有权管理的本地、BOT 渠道与 Project 会话。日常侧栏只显示未归档、未删除的会话。",
      tabActive: "进行中",
      tabArchived: "已归档",
      tabTrash: "回收站",
      filterBot: "BOT",
      filterBotPh: "BOT ID（逗号分隔）",
      filterSource: "来源",
      sourceAll: "全部来源",
      sourceLocal: "本地",
      sourceProject: "Project",
      sourceExternal: "外部渠道",
      filterKeyword: "关键词",
      filterKeywordPh: "搜索标题与可检索内容...",
      filterInactive: "不活跃",
      inactiveAny: "不限时间",
      inactive7: "7 天无对话",
      inactive30: "30 天无对话",
      inactive90: "90 天无对话",
      filterFrom: "开始日期",
      filterTo: "结束日期",
      filterEmpty: "空会话",
      filterShort: "短会话（1–2 轮）",
      filterExtraction: "提炼状态",
      extractionAll: "不限提炼状态",
      extractionProcessedOnly: "仅看已提炼未归档",
      stUnprocessed: "未提炼",
      stProcessing: "提炼中",
      stSaved: "已保存",
      stNoUseful: "无需保留",
      stPending: "待审核",
      stPartial: "部分已处理",
      stFailed: "失败",
      btnSearch: "筛选",
      btnReset: "重置",
      selectPage: "全选本页",
      selectAll: "全选全部结果",
      selectedCount: "已选 {count} 项",
      selectAllNote: "跨页全选已锁定 {count} 个会话（筛选变更会清空选择，后续新增不会自动加入）。",
      consequenceArchive: "归档后移出日常列表，内容保留且仍可搜索，查看不会自动恢复。",
      consequenceRestore: "恢复后回到归档前的状态（进行中或已归档）。",
      consequenceDelete: "删除先进入回收站，30 天后清除；记忆与独立产物保留。",
      btnArchive: "归档",
      btnRestore: "恢复",
      btnDelete: "删除",
      btnExtractArchive: "提炼并归档",
      consequenceExtract: "提炼后仅在全部成功、需保留的结果已保存、无待审核且来源无变化时归档；失败、待审核或有新消息时不归档并明示原因。提炼永不删除会话。",
      extractDone: "提炼完成：{archived} 个已归档，共 {total} 项，失败 {fail} 项。",
      extractNotArchived: "未归档",
      extractRange: "来源范围",
      extractRetained: "保留信息",
      extractMemories: "记忆",
      extractDocs: "文档",
      extractPending: "待审核候选",
      extractFailures: "失败原因",
      extractViewMemory: "在记忆中查看 →",
      btnRetry: "重试失败项",
      colTitle: "标题",
      colSource: "来源",
      colActivity: "最后对话",
      colTurns: "轮数",
      colStatus: "状态",
      colExtraction: "提炼",
      colPreview: "预览",
      btnPreview: "查看",
      noItems: "没有符合条件的会话。",
      loading: "正在加载会话...",
      loadFailed: "加载失败",
      btnReload: "重试",
      prevPage: "上一页",
      nextPage: "下一页",
      pageOf: "第 {page} / {pages} 页，共 {total} 项",
      previewTitle: "相邻预览",
      previewClose: "关闭预览",
      previewLoading: "正在加载预览...",
      previewFailed: "预览加载失败",
      previewEmpty: "该会话暂无消息。",
      sourceUnavailable: "来源不可用：该会话已被彻底清除，关联的记忆与产物不受影响。",
      deleteTitle: "确认删除",
      deleteCount: "将删除 {count} 个会话。",
      deleteRecovery: "恢复期 30 天，期间可在回收站恢复；到期后彻底清除。",
      deleteScope: "仅删除会话自有数据；已保存的记忆与独立产物会保留。",
      deleteRetainedLink: "查看关联保留物 →",
      btnCancel: "取消",
      btnConfirmDelete: "确认删除",
      opDone: "批量操作完成：成功 {ok}，跳过 {skip}，失败 {fail}。",
      policyTitle: "自动归档策略",
      policyDesc: "关闭时不自动归档。保存策略不会立即改动已列出的会话，下一次定时检查才会生效。",
      policyEnabled: "启用自动归档",
      policyDays: "全局无对话阈值（天）",
      policyPreview: "当前命中 {count} 个会话",
      policyRefreshPreview: "刷新命中预览",
      policyLastRun: "上次检查",
      policyNeverRun: "尚未运行",
      policyBots: "按 BOT 覆盖",
      policyBotId: "BOT ID",
      policyMode: "模式",
      modeInherit: "继承全局",
      modeDisabled: "停用",
      modeCustom: "自定义天数",
      btnApplyBot: "应用",
      btnRemoveBot: "移除",
      btnSavePolicy: "保存策略",
      btnResetPolicy: "重置",
      policySaving: "保存中...",
      policySaved: "策略已保存。",
      policyFailed: "策略操作失败"
    },
    "en-US": {
      eyebrow: "Session Management",
      title: "Session Management",
      desc: "Search, filter, preview and bulk archive or delete local, BOT channel and Project sessions you may manage. The daily sidebar only shows sessions that are neither archived nor deleted.",
      tabActive: "Active",
      tabArchived: "Archived",
      tabTrash: "Trash",
      filterBot: "BOT",
      filterBotPh: "BOT IDs (comma separated)",
      filterSource: "Source",
      sourceAll: "All sources",
      sourceLocal: "Local",
      sourceProject: "Project",
      sourceExternal: "External",
      filterKeyword: "Keyword",
      filterKeywordPh: "Search titles and searchable content...",
      filterInactive: "Inactivity",
      inactiveAny: "Any time",
      inactive7: "Inactive 7 days",
      inactive30: "Inactive 30 days",
      inactive90: "Inactive 90 days",
      filterFrom: "From date",
      filterTo: "To date",
      filterEmpty: "Empty sessions",
      filterShort: "Short (1–2 turns)",
      filterExtraction: "Extraction",
      extractionAll: "Any extraction state",
      extractionProcessedOnly: "Processed, not archived",
      stUnprocessed: "Not extracted",
      stProcessing: "Extracting",
      stSaved: "Saved",
      stNoUseful: "Nothing to keep",
      stPending: "Pending review",
      stPartial: "Partially processed",
      stFailed: "Failed",
      btnSearch: "Apply",
      btnReset: "Reset",
      selectPage: "Select page",
      selectAll: "Select all results",
      selectedCount: "{count} selected",
      selectAllNote: "Cross-page selection locked {count} sessions (changing filters clears it; later arrivals are not added).",
      consequenceArchive: "Archiving removes sessions from the daily list; content stays searchable and viewing never restores.",
      consequenceRestore: "Restoring returns sessions to their pre-trash state (active or archived).",
      consequenceDelete: "Deleting moves sessions to trash for 30 days; saved memories and independent artifacts survive.",
      btnArchive: "Archive",
      btnRestore: "Restore",
      btnDelete: "Delete",
      btnExtractArchive: "Extract & archive",
      consequenceExtract: "Extract-and-archive only archives when everything succeeds, required outputs are saved, nothing awaits review and the source is unchanged. Failed, pending-review or concurrently messaged sessions stay unarchived with a reason. Extraction never deletes.",
      extractDone: "Extraction done: {archived} archived of {total}, {fail} failed.",
      extractNotArchived: "Not archived",
      extractRange: "Source range",
      extractRetained: "Retained",
      extractMemories: "Memories",
      extractDocs: "Documents",
      extractPending: "Pending candidates",
      extractFailures: "Failure reasons",
      extractViewMemory: "Inspect in memories →",
      btnRetry: "Retry failed",
      colTitle: "Title",
      colSource: "Source",
      colActivity: "Last activity",
      colTurns: "Turns",
      colStatus: "Status",
      colExtraction: "Extraction",
      colPreview: "Preview",
      btnPreview: "View",
      noItems: "No matching sessions.",
      loading: "Loading sessions...",
      loadFailed: "Load failed",
      btnReload: "Retry",
      prevPage: "Previous",
      nextPage: "Next",
      pageOf: "Page {page} of {pages}, {total} items",
      previewTitle: "Transcript preview",
      previewClose: "Close preview",
      previewLoading: "Loading preview...",
      previewFailed: "Preview failed",
      previewEmpty: "No messages yet.",
      sourceUnavailable: "Source unavailable: this session was purged. Linked memories and artifacts are unaffected.",
      deleteTitle: "Confirm deletion",
      deleteCount: "{count} sessions will be deleted.",
      deleteRecovery: "30-day recovery in trash, restorable until expiry; purged afterwards.",
      deleteScope: "Only Session-owned data is removed; saved memories and independent artifacts survive.",
      deleteRetainedLink: "Inspect retained items →",
      btnCancel: "Cancel",
      btnConfirmDelete: "Confirm delete",
      opDone: "Bulk done: {ok} succeeded, {skip} skipped, {fail} failed.",
      policyTitle: "Automatic archive policy",
      policyDesc: "Nothing archives automatically while disabled. Saving never mutates the listed sessions; the next scheduled sweep applies fresh checks.",
      policyEnabled: "Enable automatic archiving",
      policyDays: "Global inactivity threshold (days)",
      policyPreview: "{count} sessions currently qualify",
      policyRefreshPreview: "Refresh preview",
      policyLastRun: "Last run",
      policyNeverRun: "Never ran",
      policyBots: "Per-BOT overrides",
      policyBotId: "BOT ID",
      policyMode: "Mode",
      modeInherit: "Inherit global",
      modeDisabled: "Disabled",
      modeCustom: "Custom days",
      btnApplyBot: "Apply",
      btnRemoveBot: "Remove",
      btnSavePolicy: "Save policy",
      btnResetPolicy: "Reset",
      policySaving: "Saving...",
      policySaved: "Policy saved.",
      policyFailed: "Policy operation failed"
    }
  };

  function t(key: string): string {
    return COPY[$locale][key] ?? key;
  }

  function fill(template: string, values: Record<string, string | number>): string {
    let out = template;
    for (const [key, value] of Object.entries(values)) out = out.replace(`{${key}}`, String(value));
    return out;
  }

  const PAGE_SIZE = 20;

  let view: View = "active";
  let botInput = "";
  let sourceSel = "all";
  let keyword = "";
  let inactive = "any";
  let fromDate = "";
  let toDate = "";
  let lenEmpty = false;
  let lenShort = false;
  let extractionFilter = "any";
  let processedOnly = false;

  let pageIdx = 0;
  let items: ManagedItem[] = [];
  let total = 0;
  let counts = { active: 0, archived: 0, trashed: 0 };
  let loading = false;
  let loadError: string | null = null;

  let selected: Record<string, number> = {};
  let selectAll: { selectionId: string; count: number } | null = null;
  let lastClickedIdx = -1;

  let previewId: string | null = null;
  let previewTitle = "";
  let previewMessages: PreviewMessage[] = [];
  let previewLoading = false;
  let previewError: string | null = null;
  let previewExtraction: ExtractionDetail | null = null;
  let previewExtractionLoading = false;
  let savedScrollY = 0;

  let bulkBusy = false;
  let bulkMessage: string | null = null;
  let bulkError: string | null = null;
  let bulkFailed = 0;
  let extractResults: ExtractItemResult[] = [];
  let extractingIds: Record<string, true> = {};
  let lastOperationId: string | null = null;
  let confirmDelete = false;
  let deleteFacts: { count: number; retentionDays: number } | null = null;

  let policyEnabled = false;
  let policyDays = 30;
  let policyBots: Record<string, { mode: string; inactiveDays?: number }> = {};
  let policyPreview: number | null = null;
  let lastRun: { finishedAt?: string; archivedCount?: number; skippedCount?: number; failedCount?: number } | null = null;
  let policyLoading = false;
  let policySaving = false;
  let policyMessage: string | null = null;
  let policyError: string | null = null;
  let newBotId = "";
  let newBotMode = "inherit";
  let newBotDays = 30;

  $: pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  $: pageIds = items.map((item) => item.conversationId);
  $: allChecked = pageIds.length > 0 && pageIds.every((id) => id in selected);
  $: someChecked = pageIds.some((id) => id in selected);
  $: selCount = selectAll?.count ?? Object.keys(selected).length;
  $: showRestore = view !== "active";
  $: consequenceKey = view === "active" ? "consequenceArchive" : "consequenceRestore";

  function buildQuery(offset: number, limit: number = PAGE_SIZE): string {
    const params = new URLSearchParams();
    params.set("state", view);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (botInput.trim()) params.set("botIds", botInput.trim());
    if (sourceSel !== "all") params.set("sources", sourceSel);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (inactive !== "any") params.set("inactiveDays", inactive);
    if (fromDate) params.set("activityFromDate", fromDate);
    if (toDate) params.set("activityToDate", toDate);
    const lengths: string[] = [];
    if (lenEmpty) lengths.push("empty");
    if (lenShort) lengths.push("short");
    if (lengths.length > 0) params.set("lengths", lengths.join(","));
    if (extractionFilter !== "any") params.set("extraction", extractionFilter);
    if (processedOnly) params.set("processedNotArchived", "true");
    return params.toString();
  }

  function clearSelection(): void {
    selected = {};
    selectAll = null;
    lastClickedIdx = -1;
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      const response = await fetch(`/api/sessions/managed?${buildQuery(pageIdx * PAGE_SIZE)}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        items?: ManagedItem[];
        total?: number;
        counts?: { active: number; archived: number; trashed: number };
      };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("loadFailed"));
      items = payload.items ?? [];
      total = payload.total ?? 0;
      counts = payload.counts ?? { active: 0, archived: 0, trashed: 0 };
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  function onFilterChange(): void {
    clearSelection();
    extractResults = [];
    pageIdx = 0;
    void load();
  }

  function onViewChange(next: string): void {
    if (next !== "active" && next !== "archived" && next !== "trashed") return;
    view = next;
    previewId = null;
    bulkMessage = null;
    bulkError = null;
    onFilterChange();
  }

  function toggleOne(id: string, version: number, checked: boolean): void {
    selectAll = null;
    if (checked) selected = { ...selected, [id]: version };
    else {
      const next = { ...selected };
      delete next[id];
      selected = next;
    }
  }

  function toggleRow(id: string, version: number, idx: number, event: MouseEvent): void {
    // Checkbox / preview-button interactions handle themselves; only plain
    // row clicks toggle here so one click never toggles twice.
    if ((event.target as HTMLElement | null)?.closest?.("button,input,label,a")) return;
    if (event.shiftKey && lastClickedIdx >= 0) {
      const [from, to] = [Math.min(lastClickedIdx, idx), Math.max(lastClickedIdx, idx)];
      const next = { ...selected };
      const targetChecked = !(items[idx].conversationId in selected);
      for (let i = from; i <= to; i += 1) {
        if (targetChecked) next[items[i].conversationId] = items[i].version;
        else delete next[items[i].conversationId];
      }
      selected = next;
      selectAll = null;
    } else {
      toggleOne(id, version, !(id in selected));
    }
    lastClickedIdx = idx;
  }

  function onRowKeydown(event: KeyboardEvent, id: string, version: number, idx: number): void {
    if (event.key === " " && (event.target as HTMLElement)?.tagName !== "INPUT") {
      event.preventDefault();
      toggleOne(id, version, !(id in selected));
      lastClickedIdx = idx;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
      document.querySelector<HTMLElement>(`[data-row-idx="${next}"]`)?.focus();
      if (event.shiftKey) toggleOne(id, version, !(id in selected));
    }
  }

  function togglePage(checked: boolean): void {
    selectAll = null;
    if (checked) {
      const next = { ...selected };
      for (const item of items) next[item.conversationId] = item.version;
      selected = next;
    } else {
      const next = { ...selected };
      for (const item of items) delete next[item.conversationId];
      selected = next;
    }
  }

  async function selectAllMatching(): Promise<void> {
    bulkError = null;
    try {
      const ids: string[] = [];
      let offset = 0;
      for (;;) {
        const response = await fetch(`/api/sessions/managed?${buildQuery(offset, 100)}`);
        const payload = (await response.json()) as { ok?: boolean; error?: string; items?: ManagedItem[]; total?: number };
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("loadFailed"));
        for (const item of payload.items ?? []) ids.push(item.conversationId);
        offset += (payload.items ?? []).length;
        if (offset >= (payload.total ?? 0) || (payload.items ?? []).length === 0) break;
      }
      const selResponse = await fetch("/api/sessions/managed/selections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targets: ids })
      });
      const selPayload = (await selResponse.json()) as { ok?: boolean; error?: string; selectionId?: string; count?: number };
      if (!selResponse.ok || !selPayload?.ok) throw new Error(selPayload?.error || t("loadFailed"));
      selected = {};
      selectAll = { selectionId: selPayload.selectionId ?? "", count: selPayload.count ?? ids.length };
    } catch (error) {
      bulkError = error instanceof Error ? error.message : String(error);
    }
  }

  async function openPreview(id: string): Promise<void> {
    savedScrollY = window.scrollY;
    previewId = id;
    previewTitle = "";
    previewMessages = [];
    previewError = null;
    previewLoading = true;
    previewExtraction = null;
    previewExtractionLoading = true;
    try {
      const response = await fetch(`/api/sessions/managed/preview?conversationId=${encodeURIComponent(id)}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        preview?: { title?: string; messages?: PreviewMessage[] };
      };
      if (!response.ok || !payload?.ok) {
        previewError = payload?.error === "source-unavailable" ? t("sourceUnavailable") : payload?.error || t("previewFailed");
      } else {
        previewTitle = payload.preview?.title || "";
        previewMessages = payload.preview?.messages ?? [];
      }
    } catch (error) {
      previewError = error instanceof Error ? error.message : String(error);
    } finally {
      previewLoading = false;
    }
    try {
      const response = await fetch(`/api/sessions/managed/extraction/status?conversationId=${encodeURIComponent(id)}`);
      const payload = (await response.json()) as { ok?: boolean; error?: string; extraction?: ExtractionDetail };
      if (response.ok && payload?.ok && payload.extraction) {
        previewExtraction = payload.extraction;
      } else if (payload?.error === "source-unavailable") {
        previewExtraction = null;
      }
    } catch {
      previewExtraction = null;
    } finally {
      previewExtractionLoading = false;
    }
  }

  function closePreview(): void {
    previewId = null;
    previewMessages = [];
    previewError = null;
    previewExtraction = null;
    requestAnimationFrame(() => window.scrollTo({ top: savedScrollY }));
  }

  function selectionPayload(): { targets?: Array<{ conversationId: string; expectedVersion: number | null }>; selectionId?: string } {
    if (selectAll) return { selectionId: selectAll.selectionId };
    return {
      targets: Object.entries(selected).map(([conversationId, expectedVersion]) => ({ conversationId, expectedVersion }))
    };
  }

  async function doBulk(kind: "archive" | "restore" | "delete"): Promise<void> {
    if (selCount === 0 || bulkBusy) return;
    if (kind === "delete" && !confirmDelete) {
      try {
        const response = await fetch(`/api/sessions/managed/bulk/describe-delete?count=${selCount}`);
        const payload = (await response.json()) as { ok?: boolean; count?: number; retentionDays?: number; error?: string };
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("loadFailed"));
        deleteFacts = { count: payload.count ?? selCount, retentionDays: payload.retentionDays ?? 30 };
        confirmDelete = true;
      } catch (error) {
        bulkError = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    bulkBusy = true;
    bulkError = null;
    bulkMessage = null;
    try {
      const response = await fetch("/api/sessions/managed/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ...selectionPayload(), idempotencyKey: crypto.randomUUID() })
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        operationId?: string;
        counts?: { succeeded: number; skipped: number; failed: number };
      };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("loadFailed"));
      lastOperationId = payload.operationId ?? null;
      bulkFailed = payload.counts?.failed ?? 0;
      bulkMessage = fill(t("opDone"), {
        ok: payload.counts?.succeeded ?? 0,
        skip: payload.counts?.skipped ?? 0,
        fail: payload.counts?.failed ?? 0
      });
      confirmDelete = false;
      clearSelection();
      await load();
    } catch (error) {
      bulkError = error instanceof Error ? error.message : String(error);
    } finally {
      bulkBusy = false;
    }
  }

  async function retryFailed(): Promise<void> {
    if (!lastOperationId || bulkBusy) return;
    bulkBusy = true;
    bulkError = null;
    try {
      const response = await fetch("/api/sessions/managed/bulk/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: lastOperationId })
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        counts?: { succeeded: number; skipped: number; failed: number };
      };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("loadFailed"));
      bulkFailed = payload.counts?.failed ?? 0;
      bulkMessage = fill(t("opDone"), {
        ok: payload.counts?.succeeded ?? 0,
        skip: payload.counts?.skipped ?? 0,
        fail: payload.counts?.failed ?? 0
      });
      await load();
    } catch (error) {
      bulkError = error instanceof Error ? error.message : String(error);
    } finally {
      bulkBusy = false;
    }
  }

  function sourceLabel(item: ManagedItem): string {
    if (item.source === "project") return item.projectId ? `Project · ${item.projectId}` : t("sourceProject");
    if (item.source === "external") return item.botId ? `${item.channel} · ${item.botId}` : t("sourceExternal");
    return item.botId ? `${t("sourceLocal")} · ${item.botId}` : t("sourceLocal");
  }

  function extractionLabel(status: string): string {
    switch (status) {
      case "processing": return t("stProcessing");
      case "saved": return t("stSaved");
      case "no-useful-information": return t("stNoUseful");
      case "pending-review": return t("stPending");
      case "partially-processed": return t("stPartial");
      case "failed": return t("stFailed");
      default: return t("stUnprocessed");
    }
  }

  function rowExtractionStatus(item: ManagedItem): string {
    if (item.conversationId in extractingIds) return "processing";
    return item.extractionStatus || "unprocessed";
  }

  async function doExtract(): Promise<void> {
    if (selCount === 0 || bulkBusy) return;
    bulkBusy = true;
    bulkError = null;
    bulkMessage = null;
    extractResults = [];
    const targetIds = selectAll ? null : Object.keys(selected);
    if (targetIds) {
      const next: Record<string, true> = {};
      for (const id of targetIds) next[id] = true;
      extractingIds = next;
    }
    try {
      const body = selectAll?.selectionId
        ? { mode: "extract-and-archive", selectionId: selectAll.selectionId, idempotencyKey: crypto.randomUUID() }
        : {
            mode: "extract-and-archive",
            targets: (targetIds ?? []).map((conversationId) => ({
              conversationId,
              expectedVersion: selected[conversationId] ?? null
            })),
            idempotencyKey: crypto.randomUUID()
          };
      const response = await fetch("/api/sessions/managed/extraction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        counts?: { total: number; archived: number; failed: number };
        items?: ExtractItemResult[];
      };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("loadFailed"));
      extractResults = payload.items ?? [];
      bulkFailed = payload.counts?.failed ?? 0;
      bulkMessage = fill(t("extractDone"), {
        archived: payload.counts?.archived ?? 0,
        total: payload.counts?.total ?? 0,
        fail: payload.counts?.failed ?? 0
      });
      clearSelection();
      await load();
    } catch (error) {
      bulkError = error instanceof Error ? error.message : String(error);
    } finally {
      extractingIds = {};
      bulkBusy = false;
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    } catch {
      return iso;
    }
  }

  async function loadPolicy(): Promise<void> {
    policyLoading = true;
    policyError = null;
    try {
      const response = await fetch("/api/settings/session-auto-archive");
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        policy?: { enabled?: boolean; inactiveDays?: number; bots?: Record<string, { mode: string; inactiveDays?: number }> };
        previewCount?: number;
        lastRun?: { finishedAt?: string; archivedCount?: number; skippedCount?: number; failedCount?: number } | null;
      };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("policyFailed"));
      policyEnabled = payload.policy?.enabled ?? false;
      policyDays = payload.policy?.inactiveDays ?? 30;
      policyBots = payload.policy?.bots ?? {};
      policyPreview = payload.previewCount ?? null;
      lastRun = payload.lastRun ?? null;
    } catch (error) {
      policyError = error instanceof Error ? error.message : String(error);
    } finally {
      policyLoading = false;
    }
  }

  async function refreshPolicyPreview(): Promise<void> {
    policyError = null;
    try {
      const response = await fetch("/api/settings/session-auto-archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: { enabled: policyEnabled, inactiveDays: policyDays, bots: policyBots } })
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; previewCount?: number };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("policyFailed"));
      policyPreview = payload.previewCount ?? 0;
    } catch (error) {
      policyError = error instanceof Error ? error.message : String(error);
    }
  }

  async function saveGlobalPolicy(): Promise<void> {
    policySaving = true;
    policyError = null;
    policyMessage = null;
    try {
      const response = await fetch("/api/settings/session-auto-archive", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ global: { enabled: policyEnabled, inactiveDays: policyDays } })
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; previewCount?: number; lastRun?: typeof lastRun };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("policyFailed"));
      policyPreview = payload.previewCount ?? policyPreview;
      lastRun = payload.lastRun ?? lastRun;
      policyMessage = t("policySaved");
    } catch (error) {
      policyError = error instanceof Error ? error.message : String(error);
    } finally {
      policySaving = false;
    }
  }

  async function applyBotOverride(botId: string, mode: string, days: number): Promise<void> {
    policySaving = true;
    policyError = null;
    policyMessage = null;
    try {
      const response = await fetch("/api/settings/session-auto-archive", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId, bot: { mode, inactiveDays: days } })
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; policy?: { bots?: typeof policyBots }; previewCount?: number };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("policyFailed"));
      policyBots = payload.policy?.bots ?? policyBots;
      policyPreview = payload.previewCount ?? policyPreview;
      policyMessage = t("policySaved");
    } catch (error) {
      policyError = error instanceof Error ? error.message : String(error);
    } finally {
      policySaving = false;
    }
  }

  async function removeBotOverride(botId: string): Promise<void> {
    policySaving = true;
    policyError = null;
    try {
      const response = await fetch("/api/settings/session-auto-archive", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId })
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; policy?: { bots?: typeof policyBots }; previewCount?: number };
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || t("policyFailed"));
      policyBots = payload.policy?.bots ?? {};
      policyPreview = payload.previewCount ?? policyPreview;
    } catch (error) {
      policyError = error instanceof Error ? error.message : String(error);
    } finally {
      policySaving = false;
    }
  }

  function resetFilters(): void {
    botInput = "";
    sourceSel = "all";
    keyword = "";
    inactive = "any";
    fromDate = "";
    toDate = "";
    lenEmpty = false;
    lenShort = false;
    extractionFilter = "any";
    processedOnly = false;
    onFilterChange();
  }

  onMount(() => {
    void load();
    void loadPolicy();
  });
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{t("eyebrow")}</span>
    <h1 class="channel-hero-title">{t("title")}</h1>
    <p class="channel-hero-desc">{t("desc")}</p>
  </header>

  <div class="channel-card">
    <div class="channel-card-body">
      <Tabs value={view} onValueChange={(next) => next && onViewChange(next)}>
        <TabsList aria-label={t("title")}>
          <TabsTrigger value="active">{t("tabActive")} ({counts.active})</TabsTrigger>
          <TabsTrigger value="archived">{t("tabArchived")} ({counts.archived})</TabsTrigger>
          <TabsTrigger value="trashed">{t("tabTrash")} ({counts.trashed})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div class="channel-field-row">
        <div class="channel-field">
          <Label for="sm-bot">{t("filterBot")}</Label>
          <Input id="sm-bot" bind:value={botInput} placeholder={t("filterBotPh")} on:change={onFilterChange} />
        </div>
        <div class="channel-field">
          <Label for="sm-source">{t("filterSource")}</Label>
          <NativeSelect id="sm-source" bind:value={sourceSel} on:change={onFilterChange}>
            <NativeSelectOption value="all">{t("sourceAll")}</NativeSelectOption>
            <NativeSelectOption value="local">{t("sourceLocal")}</NativeSelectOption>
            <NativeSelectOption value="project">{t("sourceProject")}</NativeSelectOption>
            <NativeSelectOption value="external">{t("sourceExternal")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <div class="channel-field">
          <Label for="sm-keyword">{t("filterKeyword")}</Label>
          <Input id="sm-keyword" bind:value={keyword} placeholder={t("filterKeywordPh")} on:change={onFilterChange} />
        </div>
        <div class="channel-field">
          <Label for="sm-inactive">{t("filterInactive")}</Label>
          <NativeSelect id="sm-inactive" bind:value={inactive} on:change={onFilterChange}>
            <NativeSelectOption value="any">{t("inactiveAny")}</NativeSelectOption>
            <NativeSelectOption value="7">{t("inactive7")}</NativeSelectOption>
            <NativeSelectOption value="30">{t("inactive30")}</NativeSelectOption>
            <NativeSelectOption value="90">{t("inactive90")}</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>

      <div class="channel-field-row">
        <div class="channel-field">
          <Label for="sm-from">{t("filterFrom")}</Label>
          <Input id="sm-from" type="date" bind:value={fromDate} on:change={onFilterChange} />
        </div>
        <div class="channel-field">
          <Label for="sm-to">{t("filterTo")}</Label>
          <Input id="sm-to" type="date" bind:value={toDate} on:change={onFilterChange} />
        </div>
        <div class="channel-field">
          <Label for="sm-empty">{t("filterEmpty")}</Label>
          <Checkbox id="sm-empty" checked={lenEmpty} onCheckedChange={(v) => { lenEmpty = v === true; onFilterChange(); }} />
        </div>
        <div class="channel-field">
          <Label for="sm-short">{t("filterShort")}</Label>
          <Checkbox id="sm-short" checked={lenShort} onCheckedChange={(v) => { lenShort = v === true; onFilterChange(); }} />
        </div>
      </div>

      <div class="channel-field-row">
        <div class="channel-field">
          <Label for="sm-extraction">{t("filterExtraction")}</Label>
          <NativeSelect id="sm-extraction" bind:value={extractionFilter} on:change={onFilterChange}>
            <NativeSelectOption value="any">{t("extractionAll")}</NativeSelectOption>
            <NativeSelectOption value="unprocessed">{t("stUnprocessed")}</NativeSelectOption>
            <NativeSelectOption value="saved">{t("stSaved")}</NativeSelectOption>
            <NativeSelectOption value="no-useful-information">{t("stNoUseful")}</NativeSelectOption>
            <NativeSelectOption value="pending-review">{t("stPending")}</NativeSelectOption>
            <NativeSelectOption value="partially-processed">{t("stPartial")}</NativeSelectOption>
            <NativeSelectOption value="failed">{t("stFailed")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <div class="channel-field">
          <Label for="sm-processed-only">{t("extractionProcessedOnly")}</Label>
          <Checkbox id="sm-processed-only" checked={processedOnly} onCheckedChange={(v) => { processedOnly = v === true; onFilterChange(); }} />
        </div>
      </div>

      <div class="channel-actions">
        <Button size="sm" onclick={onFilterChange}>{t("btnSearch")}</Button>
        <Button size="sm" variant="outline" onclick={resetFilters}>{t("btnReset")}</Button>
      </div>
    </div>
  </div>

  {#if loadError}
    <Alert variant="destructive">
      <AlertTitle>{t("loadFailed")}</AlertTitle>
      <AlertDescription>{loadError} <Button size="sm" variant="outline" onclick={load}>{t("btnReload")}</Button></AlertDescription>
    </Alert>
  {/if}

  <div class="channel-card">
    <div class="channel-card-header">
      <div>
        <h2 class="channel-card-title">{fill(t("selectedCount"), { count: selCount })}</h2>
        <p class="channel-card-desc">{t(consequenceKey)} {t("consequenceDelete")}</p>
        <p class="channel-card-desc">{t("consequenceExtract")}</p>
        {#if selectAll}
          <p class="channel-card-desc">{fill(t("selectAllNote"), { count: selectAll.count })}</p>
        {/if}
      </div>
      <div class="channel-actions">
        <Button size="sm" variant="outline" disabled={loading || items.length === 0} onclick={() => togglePage(!allChecked)}>
          {t("selectPage")}
        </Button>
        <Button size="sm" variant="outline" disabled={loading || total === 0} onclick={selectAllMatching}>
          {t("selectAll")}
        </Button>
        {#if view === "active"}
          <Button size="sm" disabled={selCount === 0 || bulkBusy} onclick={() => doBulk("archive")}>{t("btnArchive")}</Button>
        {/if}
        {#if showRestore}
          <Button size="sm" disabled={selCount === 0 || bulkBusy} onclick={() => doBulk("restore")}>{t("btnRestore")}</Button>
        {/if}
        <Button size="sm" variant="secondary" disabled={selCount === 0 || bulkBusy} onclick={doExtract}>
          {t("btnExtractArchive")}
        </Button>
        <Button size="sm" variant="destructive" disabled={selCount === 0 || bulkBusy} onclick={() => doBulk("delete")}>{t("btnDelete")}</Button>
        {#if bulkFailed > 0 && lastOperationId}
          <Button size="sm" variant="outline" disabled={bulkBusy} onclick={retryFailed}>{t("btnRetry")}</Button>
        {/if}
      </div>
    </div>

    <div class="channel-card-body">
      {#if bulkMessage}
        <div class="channel-hint">{bulkMessage}</div>
      {/if}
      {#if extractResults.length > 0}
        {#each extractResults as result (result.conversationId)}
          <div class="channel-field">
            <p class="settings-item-label">
              {result.conversationId} · {extractionLabel(result.status)} · {result.archived ? t("tabArchived") : t("extractNotArchived")}
            </p>
            {#if result.archiveReason}
              <p class="settings-item-desc">{result.archiveReason}</p>
            {/if}
            {#each result.failureReasons as reason}
              <p class="settings-item-desc">{reason}</p>
            {/each}
          </div>
        {/each}
      {/if}
      {#if bulkError}
        <Alert variant="destructive"><AlertDescription>{bulkError}</AlertDescription></Alert>
      {/if}
      {#if loading}
        <Skeleton />
        <p class="channel-hint">{t("loading")}</p>
      {:else if items.length === 0}
        <p class="channel-hint">{t("noItems")}</p>
      {:else}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} onCheckedChange={(v) => togglePage(v === true)} aria-label={t("selectPage")} /></TableHead>
              <TableHead>{t("colTitle")}</TableHead>
              <TableHead>{t("colSource")}</TableHead>
              <TableHead>{t("colActivity")}</TableHead>
              <TableHead>{t("colTurns")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colExtraction")}</TableHead>
              <TableHead>{t("colPreview")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#each items as item, idx (item.conversationId)}
              <TableRow
                data-row-idx={idx}
                tabindex={0}
                aria-selected={item.conversationId in selected}
                on:click={(event) => toggleRow(item.conversationId, item.version, idx, event)}
                on:keydown={(event) => onRowKeydown(event, item.conversationId, item.version, idx)}
              >
                <TableCell>
                  <Checkbox
                    checked={item.conversationId in selected}
                    onCheckedChange={(v) => toggleOne(item.conversationId, item.version, v === true)}
                    aria-label={item.title}
                  />
                </TableCell>
                <TableCell>{item.title || item.conversationId}</TableCell>
                <TableCell><Badge variant="secondary">{sourceLabel(item)}</Badge></TableCell>
                <TableCell>{formatDate(item.lastActivityAt)}</TableCell>
                <TableCell>{item.userTurnCount}</TableCell>
                <TableCell>
                  {#if item.retain}<Badge>{item.state} · retain</Badge>{:else}<Badge variant="outline">{item.state}</Badge>{/if}
                </TableCell>
                <TableCell>
                  {#if rowExtractionStatus(item) === "unprocessed"}
                    <Badge variant="outline">{extractionLabel("unprocessed")}</Badge>
                  {:else if rowExtractionStatus(item) === "failed"}
                    <Badge variant="destructive">{extractionLabel("failed")}</Badge>
                  {:else}
                    <Badge variant="secondary">{extractionLabel(rowExtractionStatus(item))}</Badge>
                  {/if}
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onclick={(event) => { event.stopPropagation(); void openPreview(item.conversationId); }}>
                    {t("btnPreview")}
                  </Button>
                </TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
        <div class="channel-actions">
          <Button size="sm" variant="outline" disabled={pageIdx === 0 || loading} onclick={() => { pageIdx -= 1; void load(); }}>{t("prevPage")}</Button>
          <span class="channel-hint">{fill(t("pageOf"), { page: pageIdx + 1, pages: pageCount, total })}</span>
          <Button size="sm" variant="outline" disabled={pageIdx + 1 >= pageCount || loading} onclick={() => { pageIdx += 1; void load(); }}>{t("nextPage")}</Button>
        </div>
      {/if}
    </div>
  </div>

  {#if previewId}
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{t("previewTitle")}</h2>
          <p class="channel-card-desc">{previewTitle || previewId}</p>
        </div>
        <div class="channel-actions">
          <Button size="sm" variant="outline" onclick={closePreview}>{t("previewClose")}</Button>
        </div>
      </div>
      <div class="channel-card-body">
        {#if previewLoading}
          <Skeleton />
          <p class="channel-hint">{t("previewLoading")}</p>
        {:else if previewError}
          <Alert variant="destructive"><AlertDescription>{previewError}</AlertDescription></Alert>
        {:else if previewMessages.length === 0}
          <p class="channel-hint">{t("previewEmpty")}</p>
        {:else}
          {#each previewMessages as message (message.createdAt + message.role + message.content.slice(0, 24))}
            <div class="channel-field">
              <p class="settings-item-label">{message.role} · {formatDate(message.createdAt)}</p>
              <p class="settings-item-desc">{message.content}</p>
            </div>
          {/each}
        {/if}
        {#if previewExtractionLoading}
          <Skeleton />
        {:else if previewExtraction}
          <div class="channel-field">
            <p class="settings-item-label">{t("colExtraction")} · {extractionLabel(previewExtraction.status)}</p>
            {#if previewExtraction.processedThroughId || previewExtraction.messageRevision}
              <p class="settings-item-desc">
                {t("extractRange")}: {previewExtraction.processedThroughId ?? "—"}{previewExtraction.messageRevision
                  ? ` · ${previewExtraction.messageRevision}`
                  : ""}
              </p>
            {/if}
            {#if previewExtraction.savedMemoryIds.length > 0 || previewExtraction.savedDocRefs.length > 0}
              <p class="settings-item-desc">
                {t("extractRetained")}: {t("extractMemories")} {previewExtraction.savedMemoryIds.length} · {t("extractDocs")} {previewExtraction.savedDocRefs.length}
                <a class="text-primary hover:underline font-medium" href="/settings/memory">{t("extractViewMemory")}</a>
              </p>
            {/if}
            {#each previewExtraction.savedDocRefs as doc}
              <p class="settings-item-desc">{doc.title ?? doc.docId} · {doc.docId}</p>
            {/each}
            {#if previewExtraction.pendingCandidateIds.length > 0}
              <p class="settings-item-desc">{t("extractPending")}: {previewExtraction.pendingCandidateIds.join(", ")}</p>
            {/if}
            {#each previewExtraction.failureReasons as reason}
              <p class="settings-item-desc">{reason}</p>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="channel-card">
    <div class="channel-card-header">
      <div>
        <h2 class="channel-card-title">{t("policyTitle")}</h2>
        <p class="channel-card-desc">{t("policyDesc")}</p>
      </div>
    </div>
    <form
      id="session-policy-form"
      class="channel-card-body"
      on:submit={(event) => { event.preventDefault(); void saveGlobalPolicy(); }}
    >
      {#if policyError}
        <Alert variant="destructive"><AlertDescription>{policyError}</AlertDescription></Alert>
      {/if}
      {#if policyMessage}
        <p class="channel-hint">{policyMessage}</p>
      {/if}
      <div class="channel-field">
        <Label for="sm-policy-enabled">{t("policyEnabled")}</Label>
        <Switch id="sm-policy-enabled" checked={policyEnabled} onCheckedChange={(v) => { policyEnabled = v === true; void refreshPolicyPreview(); }} />
      </div>
      <div class="channel-field">
        <Label for="sm-policy-days">{t("policyDays")}</Label>
        <Input id="sm-policy-days" type="number" min="1" step="1" bind:value={policyDays} on:change={refreshPolicyPreview} />
      </div>
      <p class="channel-hint">
        {policyPreview === null ? "" : fill(t("policyPreview"), { count: policyPreview })}
        {lastRun ? ` · ${t("policyLastRun")}: ${lastRun.finishedAt ?? ""}` : ` · ${t("policyNeverRun")}`}
      </p>
      <div class="channel-actions">
        <Button size="sm" variant="outline" onclick={refreshPolicyPreview} disabled={policyLoading}>{t("policyRefreshPreview")}</Button>
      </div>
      <h3 class="settings-item-label">{t("policyBots")}</h3>
      {#each Object.entries(policyBots) as [botId, override] (botId)}
        <div class="channel-field-row">
          <div class="channel-field">
            <Label>{t("policyBotId")}</Label>
            <p class="settings-item-desc">{botId}</p>
          </div>
          <div class="channel-field">
            <Label for={`sm-bot-mode-${botId}`}>{t("policyMode")}</Label>
            <NativeSelect
              id={`sm-bot-mode-${botId}`}
              value={override.mode}
              on:change={(event) => { const next = (event.target as HTMLSelectElement).value; policyBots = { ...policyBots, [botId]: { ...override, mode: next } }; }}
            >
              <NativeSelectOption value="inherit">{t("modeInherit")}</NativeSelectOption>
              <NativeSelectOption value="disabled">{t("modeDisabled")}</NativeSelectOption>
              <NativeSelectOption value="custom">{t("modeCustom")}</NativeSelectOption>
            </NativeSelect>
          </div>
          <div class="channel-field">
            <Label for={`sm-bot-days-${botId}`}>{t("policyDays")}</Label>
            <Input
              id={`sm-bot-days-${botId}`}
              type="number"
              min="1"
              step="1"
              value={override.inactiveDays ?? policyDays}
              disabled={override.mode !== "custom"}
              on:change={(event) => { const next = Math.floor(Number((event.target as HTMLInputElement).value)); policyBots = { ...policyBots, [botId]: { ...override, inactiveDays: next } }; }}
            />
          </div>
          <div class="channel-actions">
            <Button
              size="sm"
              variant="outline"
              onclick={() => applyBotOverride(botId, policyBots[botId].mode, policyBots[botId].inactiveDays ?? policyDays)}
              disabled={policySaving}
            >
              {t("btnApplyBot")}
            </Button>
            <Button size="sm" variant="ghost" onclick={() => removeBotOverride(botId)} disabled={policySaving}>
              {t("btnRemoveBot")}
            </Button>
          </div>
        </div>
      {/each}
      <div class="channel-field-row">
        <div class="channel-field">
          <Label for="sm-new-bot">{t("policyBotId")}</Label>
          <Input id="sm-new-bot" bind:value={newBotId} placeholder="personal" />
        </div>
        <div class="channel-field">
          <Label for="sm-new-mode">{t("policyMode")}</Label>
          <NativeSelect id="sm-new-mode" bind:value={newBotMode}>
            <NativeSelectOption value="inherit">{t("modeInherit")}</NativeSelectOption>
            <NativeSelectOption value="disabled">{t("modeDisabled")}</NativeSelectOption>
            <NativeSelectOption value="custom">{t("modeCustom")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <div class="channel-field">
          <Label for="sm-new-days">{t("policyDays")}</Label>
          <Input id="sm-new-days" type="number" min="1" step="1" bind:value={newBotDays} disabled={newBotMode !== "custom"} />
        </div>
        <div class="channel-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={!newBotId.trim() || policySaving}
            onclick={() => { const id = newBotId.trim(); void applyBotOverride(id, newBotMode, newBotDays).then(() => { newBotId = ""; }); }}
          >
            {t("btnApplyBot")}
          </Button>
        </div>
      </div>
    </form>
  </div>

  <footer class="settings-footbar">
    <div class="settings-footbar-status">
      {#if policySaving}
        <span class="settings-footbar-saving"><span class="settings-footbar-pulse"></span>{t("policySaving")}</span>
      {:else if policyMessage}
        <span class="settings-footbar-ok">{policyMessage}</span>
      {/if}
      {#if policyError}
        <span class="settings-footbar-error">{policyError}</span>
      {/if}
    </div>
    <div class="settings-footbar-actions">
      <Button variant="outline" size="sm" onclick={loadPolicy} disabled={policyLoading || policySaving}>{t("btnResetPolicy")}</Button>
      <button type="submit" form="session-policy-form" class="settings-footbar-btn" disabled={policyLoading || policySaving}>
        {policySaving ? t("policySaving") : t("btnSavePolicy")}
      </button>
    </div>
  </footer>
</div>

{#if confirmDelete && deleteFacts}
  <div class="providers-modal-backdrop" role="presentation" on:click={() => (confirmDelete = false)} on:keydown={(e) => e.key === "Escape" && (confirmDelete = false)}>
    <div class="providers-modal-card" role="alertdialog" aria-modal="true" aria-label={t("deleteTitle")}>
      <h2 class="channel-card-title">{t("deleteTitle")}</h2>
      <p class="settings-item-desc">{fill(t("deleteCount"), { count: deleteFacts.count })}</p>
      <p class="settings-item-desc">{t("deleteRecovery")}</p>
      <p class="settings-item-desc">{t("deleteScope")}</p>
      <p class="channel-hint"><a class="text-primary hover:underline font-medium" href="/settings/memory">{t("deleteRetainedLink")}</a></p>
      <div class="channel-actions">
        <Button size="sm" variant="outline" onclick={() => (confirmDelete = false)}>{t("btnCancel")}</Button>
        <Button size="sm" variant="destructive" disabled={bulkBusy} onclick={() => doBulk("delete")}>{t("btnConfirmDelete")}</Button>
      </div>
    </div>
  </div>
{/if}
