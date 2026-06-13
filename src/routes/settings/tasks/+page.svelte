<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { Textarea } from "$lib/components/ui/textarea";
  import { locale } from "$lib/ui/i18n";

  type TaskType = "one-shot" | "periodic" | "immediate";
  type TaskStatus = "pending" | "running" | "completed" | "skipped" | "error";
  type TaskScope = "workspace" | "chat-scratch";
  type TaskChannel = "telegram" | "feishu" | "qq" | "weixin";

  interface TaskItem {
    channel: TaskChannel; botId: string; chatId: string; scope: TaskScope; filename: string;
    filePath: string; type: TaskType; delivery: string; text: string; scheduleText: string;
    timezone: string; sessionMode: string; status: TaskStatus; statusReason: string; lastError: string;
    runCount: number; completedAt: string; lastTriggeredAt: string; updatedAt: string; createdAt: string;
  }

  interface Counts {
    total: number;
    byType: Record<TaskType, number>;
    byStatus: Record<TaskStatus, number>;
    byScope: { workspace: number; chatScratch: number };
    byChannel: Record<TaskChannel, number>;
  }

  interface DeleteResult {
    deleted?: string[]; triggered?: string[]; failed?: Array<{ filePath: string; reason: string }>;
  }

  interface UpdateResult { updated?: string; ok?: boolean; error?: string; }

  interface TaskEditDraft { text: string; delivery: string; scheduleText: string; timezone: string; sessionMode: string; }

  const COPY = {
    "zh-CN": {
      eyebrow: "事件运行时",
      title: "任务",
      desc: "检查定时事件任务、选择行条目并批量删除或触发运行。",
      btnRefresh: "刷新",
      btnTriggerSelected: "触发所选 ({size})",
      btnTriggering: "触发中...",
      btnDeleteSelected: "删除所选 ({size})",
      btnDeleting: "删除中...",
      loading: "正在加载任务...",
      dataRoot: "数据根目录：",
      countTotal: "总数",
      countWorkspace: "工作区",
      countChatScratch: "会话临时",
      countPending: "待执行",
      countRunning: "运行中",
      countCompleted: "已完成",
      countSkipped: "已跳过",
      countError: "错误",
      batchTitle: "批量操作",
      selectedCount: "个已选择",
      btnSelectAll: "全选",
      btnClearSelection: "清除选择",
      tasksHeading: "任务",
      tasksDesc: "个任务，{selected} 个已选",
      btnUnselectSection: "取消选择本组",
      btnSelectSection: "选择本组",
      noTasksMsg: "无 {type} 任务。",
      colSelect: "选择",
      colFilename: "文件名",
      colEvent: "事件/指令",
      colScopeChannel: "作用域 / 渠道",
      colSchedule: "调度规则",
      colDelivery: "投递方式",
      colSessionMode: "会话隔离",
      colStatus: "状态",
      colRunCount: "执行次数",
      colActions: "操作",
      showMore: "展开",
      showLess: "收起",
      btnRetry: "触发",
      btnSave: "保存",
      btnSaving: "保存中...",
      btnCancel: "取消",
      btnEdit: "编辑",
      btnDelete: "删除",
      lastTrigger: "上次：",
      createdTime: "创建：",
      failedLoad: "加载任务失败",
      loadedMsg: "已加载 {count} 个任务。",
      taskUpdated: "任务已更新。",
      updateFailed: "更新任务失败",
      deleteSuccess: "已删除 {count} 个任务。",
      triggerSuccess: "已触发 {count} 个任务。"
    },
    "en-US": {
      eyebrow: "Event Runtime",
      title: "Tasks",
      desc: "Inspect scheduled event tasks, select entries, and manage or trigger them in batches.",
      btnRefresh: "Refresh",
      btnTriggerSelected: "Trigger Selected ({size})",
      btnTriggering: "Sending...",
      btnDeleteSelected: "Delete Selected ({size})",
      btnDeleting: "Deleting...",
      loading: "Loading tasks...",
      dataRoot: "Data root: ",
      countTotal: "Total",
      countWorkspace: "Workspace",
      countChatScratch: "Chat scratch",
      countPending: "Pending",
      countRunning: "Running",
      countCompleted: "Completed",
      countSkipped: "Skipped",
      countError: "Error",
      batchTitle: "Batch Operations",
      selectedCount: "selected",
      btnSelectAll: "Select All",
      btnClearSelection: "Clear Selection",
      tasksHeading: "Tasks",
      tasksDesc: "task(s), {selected} selected",
      btnUnselectSection: "Unselect Section",
      btnSelectSection: "Select Section",
      noTasksMsg: "No {type} tasks.",
      colSelect: "Select",
      colFilename: "Filename",
      colEvent: "Event",
      colScopeChannel: "Scope / Channel",
      colSchedule: "Schedule",
      colDelivery: "Delivery",
      colSessionMode: "Session",
      colStatus: "Status",
      colRunCount: "Run Count",
      colActions: "Actions",
      showMore: "Show more",
      showLess: "Show less",
      btnRetry: "Retry",
      btnSave: "Save",
      btnSaving: "Saving...",
      btnCancel: "Cancel",
      btnEdit: "Edit",
      btnDelete: "Delete",
      lastTrigger: "last: ",
      createdTime: "created: ",
      failedLoad: "Failed to load tasks",
      loadedMsg: "Loaded {count} task(s).",
      taskUpdated: "Task updated.",
      updateFailed: "Failed to update task",
      deleteSuccess: "Deleted {count} task(s).",
      triggerSuccess: "Triggered {count} task(s)."
    }
  } as const;

  let loading = true;
  let deleting = false;
  let triggering = false;
  let saving = false;
  let error = "";
  let message = "";
  let dataRoot = "";
  let diagnostics: string[] = [];
  let items: TaskItem[] = [];
  let selected = new Set<string>();
  let editingFilePath = "";
  let editDraft: TaskEditDraft = { text: "", delivery: "agent", scheduleText: "", timezone: "", sessionMode: "" };
  let expandedText = new Set<string>();
  let counts: Counts = {
    total: 0,
    byType: { "one-shot": 0, periodic: 0, immediate: 0 },
    byStatus: { pending: 0, running: 0, completed: 0, skipped: 0, error: 0 },
    byScope: { workspace: 0, chatScratch: 0 },
    byChannel: { telegram: 0, feishu: 0, qq: 0, weixin: 0 }
  };

  $: copy = COPY[$locale] ?? COPY["en-US"];

  const typeOrder: TaskType[] = ["one-shot", "periodic", "immediate"];
  $: typeLabels = {
    "one-shot": $locale === "zh-CN" ? "单次执行 (One-shot)" : "One-shot",
    "periodic": $locale === "zh-CN" ? "周期定时 (Periodic)" : "Periodic",
    "immediate": $locale === "zh-CN" ? "立即执行 (Immediate)" : "Immediate"
  };

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }

  function statusVariant(status: TaskStatus): "default" | "destructive" | "secondary" | "outline" {
    if (status === "running") return "default";
    if (status === "completed") return "default";
    if (status === "error") return "destructive";
    if (status === "skipped") return "secondary";
    return "outline";
  }

  function rowsByType(type: TaskType): TaskItem[] {
    return items.filter((item) => item.type === type);
  }

  function beginEdit(item: TaskItem): void {
    editingFilePath = item.filePath;
    editDraft = { text: item.text || "", delivery: item.delivery || "agent", scheduleText: item.scheduleText || "", timezone: item.timezone || "", sessionMode: item.sessionMode || "" };
    error = ""; message = "";
  }

  function cancelEdit(): void {
    editingFilePath = "";
    editDraft = { text: "", delivery: "agent", scheduleText: "", timezone: "", sessionMode: "" };
  }

  async function saveEdit(item: TaskItem): Promise<void> {
    if (!editingFilePath || editingFilePath !== item.filePath || saving) return;
    saving = true; error = "";
    try {
      const patch: Record<string, string> = { text: editDraft.text, delivery: editDraft.delivery, sessionMode: editDraft.sessionMode };
      if (item.type === "one-shot") patch.at = editDraft.scheduleText;
      if (item.type === "periodic") { patch.schedule = editDraft.scheduleText; patch.timezone = editDraft.timezone; }
      const res = await fetch("/api/settings/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update", filePath: item.filePath, patch }) });
      const data = (await res.json()) as UpdateResult;
      if (!res.ok || !data?.ok) throw new Error(data?.error || copy.updateFailed);
      message = copy.taskUpdated;
      cancelEdit();
      await loadTasks();
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { saving = false; }
  }

  function toggleSelection(filePath: string): void {
    const next = new Set(selected);
    if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
    selected = next;
  }

  function clearSelection(): void { selected = new Set(); }
  function selectRows(rows: TaskItem[]): void { const next = new Set(selected); for (const row of rows) next.add(row.filePath); selected = next; }
  function selectAllTasks(): void { selected = new Set(items.map((item) => item.filePath)); }
  function selectedCountFor(type: TaskType): number { return rowsByType(type).filter((item) => selected.has(item.filePath)).length; }
  function allSelectedFor(type: TaskType): boolean { const rows = rowsByType(type); return rows.length > 0 && rows.every((item) => selected.has(item.filePath)); }

  function toggleTextExpand(filePath: string): void {
    const next = new Set(expandedText);
    if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
    expandedText = next;
  }

  async function loadTasks(): Promise<void> {
    loading = true; error = "";
    try {
      const res = await fetch("/api/settings/tasks");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);
      dataRoot = String(data.dataRoot ?? "");
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      items = Array.isArray(data.items) ? data.items : [];
      counts = data.counts ? { total: Number(data.counts.total ?? 0), byType: data.counts.byType ?? counts.byType, byStatus: data.counts.byStatus ?? counts.byStatus, byScope: data.counts.byScope ?? counts.byScope, byChannel: data.counts.byChannel ?? counts.byChannel } : counts;
      selected = new Set([...selected].filter((fp) => items.some((item) => item.filePath === fp)));
      message = copy.loadedMsg.replace("{count}", String(items.length));
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { loading = false; }
  }

  async function deleteTasks(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0 || deleting) return;
    deleting = true; error = "";
    try {
      const res = await fetch("/api/settings/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", filePaths }) });
      const data = (await res.json()) as DeleteResult & { ok?: boolean; error?: string };
      const deleted = Array.isArray(data.deleted) ? data.deleted : [];
      const failed = Array.isArray(data.failed) ? data.failed : [];
      if (deleted.length > 0) selected = new Set([...selected].filter((fp) => !deleted.includes(fp)));
      if (failed.length > 0) { const details = failed.map((item) => `${item.filePath} (${item.reason})`).join("; "); throw new Error(`Deleted ${deleted.length} task(s), but some failed: ${details}`); }
      message = copy.deleteSuccess.replace("{count}", String(deleted.length));
      await loadTasks();
    } catch (e) { error = e instanceof Error ? e.message : String(e); await loadTasks(); }
    finally { deleting = false; }
  }

  function deleteOne(filePath: string): Promise<void> { return deleteTasks([filePath]); }
  function deleteSelected(): Promise<void> { return deleteTasks([...selected]); }

  async function triggerTasks(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0 || triggering) return;
    triggering = true; error = "";
    try {
      const res = await fetch("/api/settings/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "trigger", filePaths }) });
      const data = (await res.json()) as DeleteResult & { ok?: boolean; error?: string };
      const triggered = Array.isArray(data.triggered) ? data.triggered : [];
      const failed = Array.isArray(data.failed) ? data.failed : [];
      if (failed.length > 0) { const details = failed.map((item) => `${item.filePath} (${item.reason})`).join("; "); throw new Error(`Triggered ${triggered.length} task(s), but some failed: ${details}`); }
      message = copy.triggerSuccess.replace("{count}", String(triggered.length));
      await loadTasks();
    } catch (e) { error = e instanceof Error ? e.message : String(e); await loadTasks(); }
    finally { triggering = false; }
  }

  function triggerOne(filePath: string): Promise<void> { return triggerTasks([filePath]); }
  function triggerSelected(): Promise<void> { return triggerTasks([...selected]); }

  onMount(loadTasks);
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.desc}</p>
  </header>

  <div class="channel-card">
    <div class="channel-card-body" style="gap: 0.75rem;">
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <Button variant="outline" onclick={loadTasks} disabled={loading || deleting || triggering}>{copy.btnRefresh}</Button>
        <Button variant="secondary" onclick={triggerSelected} disabled={selected.size === 0 || deleting || loading || triggering || saving}>
          {triggering ? copy.btnTriggering : copy.btnTriggerSelected.replace("{size}", String(selected.size))}
        </Button>
        <Button variant="destructive" onclick={deleteSelected} disabled={selected.size === 0 || deleting || loading || triggering || saving}>
          {deleting ? copy.btnDeleting : copy.btnDeleteSelected.replace("{size}", String(selected.size))}
        </Button>
      </div>
    </div>
  </div>

  {#if message || error}
    <div class="channel-card" style="padding: 1rem;">
      <div class="channel-card-body" style="gap: 0.5rem;">
        {#if message}
          <div class="settings-footbar-ok">{message}</div>
        {/if}
        {#if error}
          <div class="settings-footbar-error">{error}</div>
        {/if}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <div class="channel-card">
      <div class="channel-card-body" style="gap: 0.5rem;">
        <div class="channel-sidebar-btn-id">
          {copy.dataRoot}{dataRoot || "(unknown)"}
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <Badge variant="outline">{copy.countTotal}: {counts.total}</Badge>
          <Badge variant="outline">{copy.countWorkspace}: {counts.byScope.workspace}</Badge>
          <Badge variant="outline">{copy.countChatScratch}: {counts.byScope.chatScratch}</Badge>
          <Badge variant="outline">{copy.countPending}: {counts.byStatus.pending}</Badge>
          <Badge variant="outline">{copy.countRunning}: {counts.byStatus.running}</Badge>
          <Badge variant="default">{copy.countCompleted}: {counts.byStatus.completed}</Badge>
          <Badge variant="secondary">{copy.countSkipped}: {counts.byStatus.skipped}</Badge>
          <Badge variant="destructive">{copy.countError}: {counts.byStatus.error}</Badge>
        </div>
      </div>
    </div>

    <div class="channel-card" style="padding: 1rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <Badge variant="outline">{copy.batchTitle}</Badge>
          <span class="channel-sidebar-btn-id">{selected.size} {copy.selectedCount}</span>
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <Button variant="outline" size="sm" onclick={selectAllTasks} disabled={items.length === 0 || deleting || triggering}>{copy.btnSelectAll}</Button>
          <Button variant="outline" size="sm" onclick={clearSelection} disabled={selected.size === 0 || deleting || triggering || saving}>{copy.btnClearSelection}</Button>
          <Button variant="secondary" size="sm" onclick={triggerSelected} disabled={selected.size === 0 || deleting || triggering || saving}>{copy.btnTriggerSelected.replace(" ({size})", "")}</Button>
          <Button variant="destructive" size="sm" onclick={deleteSelected} disabled={selected.size === 0 || deleting || triggering || saving}>{copy.btnDeleteSelected.replace(" ({size})", "")}</Button>
        </div>
      </div>
    </div>

    {#each typeOrder as type}
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{typeLabels[type]} {copy.tasksHeading}</h2>
            <p class="channel-card-desc">{copy.tasksDesc.replace("{selected}", String(selectedCountFor(type))).replace("{count}", String(counts.byType[type]))}</p>
          </div>
          {#if rowsByType(type).length > 0}
            <Button variant="outline" size="sm" onclick={() => { if (allSelectedFor(type)) { selected = new Set([...selected].filter((fp) => !rowsByType(type).some((item) => item.filePath === fp))); } else { selectRows(rowsByType(type)); } }} disabled={deleting || triggering}>
              {allSelectedFor(type) ? copy.btnUnselectSection : copy.btnSelectSection}
            </Button>
          {/if}
        </div>
        <div class="channel-card-body">
          {#if rowsByType(type).length === 0}
            <div class="channel-hint">{copy.noTasksMsg.replace("{type}", typeLabels[type].toLowerCase())}</div>
          {:else}
            <div class="overflow-x-auto">
              <Table style="min-width: 1200px; table-layout: fixed;">
                <TableHeader>
                  <TableRow>
                    <TableHead style="width: 50px;">{copy.colSelect}</TableHead>
                    <TableHead style="width: 18%;">{copy.colFilename}</TableHead>
                    <TableHead style="width: 22%;">{copy.colEvent}</TableHead>
                    <TableHead style="width: 14%;">{copy.colScopeChannel}</TableHead>
                    <TableHead style="width: 14%;">{copy.colSchedule}</TableHead>
                    <TableHead style="width: 8%;">{copy.colDelivery}</TableHead>
                    <TableHead style="width: 8%;">{copy.colSessionMode}</TableHead>
                    <TableHead style="width: 12%;">{copy.colStatus}</TableHead>
                    <TableHead style="width: 8%;">{copy.colRunCount}</TableHead>
                    <TableHead style="width: 8%;">{copy.colActions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {#each rowsByType(type) as item (item.filePath)}
                    <TableRow class={selected.has(item.filePath) ? "bg-muted/40" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(item.filePath)}
                          onclick={() => toggleSelection(item.filePath)}
                          disabled={deleting || triggering || saving}
                          aria-label={`Select ${item.filename}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">
                          {item.filename}
                        </div>
                        <div class="channel-sidebar-btn-id" style="font-size: 0.6875rem;">
                          {item.filePath}
                        </div>
                      </TableCell>
                      <TableCell>
                        {#if editingFilePath === item.filePath}
                          <Textarea class="channel-textarea" style="min-height: 80px;" bind:value={editDraft.text} disabled={saving} />
                        {:else if item.text}
                          <div class={expandedText.has(item.filePath) ? "" : "line-clamp-4"}>
                            <div style="font-size: 0.8125rem;">{item.text}</div>
                          </div>
                          {#if (item.text.match(/\n/g) || []).length >= 3 || item.text.length > 150}
                            <button type="button" onclick={() => toggleTextExpand(item.filePath)} class="text-primary hover:underline" style="font-size: 0.75rem; margin-top: 0.25rem; background: none; border: none; padding: 0; cursor: pointer;">
                              {expandedText.has(item.filePath) ? copy.showLess : copy.showMore}
                            </button>
                          {/if}
                        {:else}
                          <span class="channel-sidebar-btn-id">-</span>
                        {/if}
                      </TableCell>
                      <TableCell>
                        <div class="channel-sidebar-badge" style="display: inline-block;">{item.channel}</div>
                        <div class="channel-sidebar-btn-name">{item.botId}</div>
                        <div class="channel-sidebar-btn-id">{item.chatId || "-"}</div>
                        <Badge variant="outline" class="text-[9px]">{item.scope}</Badge>
                      </TableCell>
                      <TableCell>
                        {#if editingFilePath === item.filePath}
                          {#if item.type !== "immediate"}
                            <Input bind:value={editDraft.scheduleText} placeholder={item.type === "periodic" ? "cron: 30 17 * * *" : "ISO datetime"} disabled={saving} style="margin-bottom: 0.25rem;" />
                          {/if}
                          {#if item.type === "periodic"}
                            <Input bind:value={editDraft.timezone} placeholder="Asia/Shanghai" disabled={saving} />
                          {/if}
                        {:else}
                          <div class="channel-sidebar-btn-name">{item.scheduleText || "-"}</div>
                          {#if item.timezone}
                            <div class="channel-sidebar-btn-id">{item.timezone}</div>
                          {/if}
                        {/if}
                        <div class="channel-hint">{copy.createdTime}{formatDate(item.createdAt)}</div>
                      </TableCell>
                      <TableCell>
                        {#if editingFilePath === item.filePath}
                          <NativeSelect bind:value={editDraft.delivery} disabled={saving}>
                            <NativeSelectOption value="agent">agent</NativeSelectOption>
                            <NativeSelectOption value="text">text</NativeSelectOption>
                          </NativeSelect>
                        {:else}
                          <span style="font-size: 0.8125rem;">{item.delivery}</span>
                        {/if}
                      </TableCell>
                      <TableCell>
                        {#if editingFilePath === item.filePath}
                          {@const isFresh = editDraft.sessionMode === "fresh"}
                          <div style="display: flex; flex-direction: column; align-items: center; gap: 0.25rem;">
                            <IosSwitch
                              checked={isFresh}
                              onCheckedChange={(v) => { editDraft.sessionMode = v ? "fresh" : "chat"; }}
                              disabled={saving}
                            />
                            <span class="channel-sidebar-btn-id">{isFresh ? "fresh" : "chat"}</span>
                          </div>
                        {:else}
                          {@const effectiveMode = item.sessionMode || (item.type === "periodic" ? "fresh" : "chat")}
                          <Badge variant={effectiveMode === "fresh" ? "secondary" : "outline"} class="text-[9px]">{effectiveMode}</Badge>
                        {/if}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                        {#if item.statusReason}
                          <div class="channel-sidebar-btn-id" style="margin-top: 0.25rem;">{item.statusReason}</div>
                        {/if}
                        {#if item.lastTriggeredAt}
                          <div class="channel-hint" style="margin-top: 0.125rem;">{copy.lastTrigger}{formatDate(item.lastTriggeredAt)}</div>
                        {/if}
                        {#if item.lastError}
                          <div class="channel-hint" style="color: var(--destructive); margin-top: 0.25rem;">
                            {item.lastError}
                          </div>
                        {/if}
                      </TableCell>
                      <TableCell>{item.runCount}</TableCell>
                      <TableCell>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                          <Button variant="secondary" size="sm" onclick={() => triggerOne(item.filePath)} disabled={deleting || triggering || saving || editingFilePath === item.filePath}>{copy.btnRetry}</Button>
                          {#if editingFilePath === item.filePath}
                            <Button variant="default" size="sm" onclick={() => saveEdit(item)} disabled={saving || deleting || triggering}>{saving ? copy.btnSaving : copy.btnSave}</Button>
                            <Button variant="outline" size="sm" onclick={cancelEdit} disabled={saving}>{copy.btnCancel}</Button>
                          {:else}
                            <Button variant="outline" size="sm" onclick={() => beginEdit(item)} disabled={deleting || triggering || saving}>{copy.btnEdit}</Button>
                          {/if}
                          <Button variant="destructive" size="sm" onclick={() => deleteOne(item.filePath)} disabled={deleting || triggering || saving}>{copy.btnDelete}</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  {/each}
                </TableBody>
              </Table>
            </div>
          {/if}
        </div>
      </div>
    {/each}

    {#if diagnostics.length > 0}
      <div class="channel-card" style="border-color: var(--destructive); background: color-mix(in oklab, var(--destructive) 4%, transparent);">
        <div class="channel-card-header">
          <h2 class="channel-card-title" style="color: var(--destructive);">Diagnostics</h2>
        </div>
        <div class="channel-card-body">
          {#each diagnostics as row}
            <div class="channel-hint" style="color: var(--destructive);">{row}</div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
