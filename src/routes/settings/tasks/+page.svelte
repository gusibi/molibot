<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { Textarea } from "$lib/components/ui/textarea";

  type TaskType = "one-shot" | "periodic" | "immediate";
  type TaskStatus = "pending" | "running" | "completed" | "skipped" | "error";
  type TaskScope = "workspace" | "chat-scratch";
  type TaskChannel = "telegram" | "feishu" | "qq" | "weixin";

  interface TaskItem {
    channel: TaskChannel; botId: string; chatId: string; scope: TaskScope; filename: string;
    filePath: string; type: TaskType; delivery: string; text: string; scheduleText: string;
    timezone: string; status: TaskStatus; statusReason: string; lastError: string;
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

  interface TaskEditDraft { text: string; delivery: string; scheduleText: string; timezone: string; }

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
  let editDraft: TaskEditDraft = { text: "", delivery: "agent", scheduleText: "", timezone: "" };
  let expandedText = new Set<string>();
  let counts: Counts = {
    total: 0,
    byType: { "one-shot": 0, periodic: 0, immediate: 0 },
    byStatus: { pending: 0, running: 0, completed: 0, skipped: 0, error: 0 },
    byScope: { workspace: 0, chatScratch: 0 },
    byChannel: { telegram: 0, feishu: 0, qq: 0, weixin: 0 }
  };

  const typeOrder: TaskType[] = ["one-shot", "periodic", "immediate"];
  const typeLabels: Record<TaskType, string> = { "one-shot": "One-shot", periodic: "Periodic", immediate: "Immediate" };

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
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
    editDraft = { text: item.text || "", delivery: item.delivery || "agent", scheduleText: item.scheduleText || "", timezone: item.timezone || "" };
    error = ""; message = "";
  }

  function cancelEdit(): void {
    editingFilePath = "";
    editDraft = { text: "", delivery: "agent", scheduleText: "", timezone: "" };
  }

  async function saveEdit(item: TaskItem): Promise<void> {
    if (!editingFilePath || editingFilePath !== item.filePath || saving) return;
    saving = true; error = "";
    try {
      const patch: Record<string, string> = { text: editDraft.text, delivery: editDraft.delivery };
      if (item.type === "one-shot") patch.at = editDraft.scheduleText;
      if (item.type === "periodic") { patch.schedule = editDraft.scheduleText; patch.timezone = editDraft.timezone; }
      const res = await fetch("/api/settings/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update", filePath: item.filePath, patch }) });
      const data = (await res.json()) as UpdateResult;
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to update task");
      message = "Task updated.";
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
      if (!data.ok) throw new Error(data.error || "Failed to load tasks");
      dataRoot = String(data.dataRoot ?? "");
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      items = Array.isArray(data.items) ? data.items : [];
      counts = data.counts ? { total: Number(data.counts.total ?? 0), byType: data.counts.byType ?? counts.byType, byStatus: data.counts.byStatus ?? counts.byStatus, byScope: data.counts.byScope ?? counts.byScope, byChannel: data.counts.byChannel ?? counts.byChannel } : counts;
      selected = new Set([...selected].filter((fp) => items.some((item) => item.filePath === fp)));
      message = `Loaded ${items.length} task(s).`;
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
      message = `Deleted ${deleted.length} task(s).`;
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
      message = `Triggered ${triggered.length} task(s).`;
      await loadTasks();
    } catch (e) { error = e instanceof Error ? e.message : String(e); await loadTasks(); }
    finally { triggering = false; }
  }

  function triggerOne(filePath: string): Promise<void> { return triggerTasks([filePath]); }
  function triggerSelected(): Promise<void> { return triggerTasks([...selected]); }

  onMount(loadTasks);
</script>

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Event Runtime</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Tasks</h1>
      <p class="text-sm leading-6 text-muted-foreground">Inspect scheduled event tasks, select stale entries, and remove them in batches.</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" onclick={loadTasks} disabled={loading || deleting || triggering}>Refresh</Button>
      <Button variant="secondary" onclick={triggerSelected} disabled={selected.size === 0 || deleting || loading || triggering || saving}>
        {triggering ? "Sending..." : `Send Selected (${selected.size})`}
      </Button>
      <Button variant="destructive" onclick={deleteSelected} disabled={selected.size === 0 || deleting || loading || triggering || saving}>
        {deleting ? "Deleting..." : `Delete Selected (${selected.size})`}
      </Button>
    </div>
  </header>

  {#if message}
    <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
  {/if}
  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading tasks...</p>
  {:else}
    <div class="flex flex-wrap gap-2 text-sm">
      <Badge variant="outline" class="max-w-full whitespace-normal break-all text-left leading-5">Data root: {dataRoot || "(unknown)"}</Badge>
      <Badge variant="outline" class="whitespace-normal">Total: {counts.total}</Badge>
      <Badge variant="outline" class="whitespace-normal">Workspace: {counts.byScope.workspace}</Badge>
      <Badge variant="outline" class="whitespace-normal">Chat scratch: {counts.byScope.chatScratch}</Badge>
      <Badge variant="outline" class="whitespace-normal">Pending: {counts.byStatus.pending}</Badge>
      <Badge variant="outline" class="whitespace-normal">Running: {counts.byStatus.running}</Badge>
      <Badge variant="default" class="whitespace-normal">Completed: {counts.byStatus.completed}</Badge>
      <Badge variant="secondary" class="whitespace-normal">Skipped: {counts.byStatus.skipped}</Badge>
      <Badge variant="destructive" class="whitespace-normal">Error: {counts.byStatus.error}</Badge>
    </div>

    <Card>
      <CardContent class="flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="whitespace-normal text-xs uppercase tracking-[0.14em]">Batch Operations</Badge>
          <span class="text-sm text-muted-foreground">{selected.size} selected</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onclick={selectAllTasks} disabled={items.length === 0 || deleting || triggering}>Select All</Button>
          <Button variant="outline" size="sm" onclick={clearSelection} disabled={selected.size === 0 || deleting || triggering || saving}>Clear Selection</Button>
          <Button variant="secondary" size="sm" onclick={triggerSelected} disabled={selected.size === 0 || deleting || triggering || saving}>Send Selected</Button>
          <Button variant="destructive" size="sm" onclick={deleteSelected} disabled={selected.size === 0 || deleting || triggering || saving}>Delete Selected</Button>
        </div>
      </CardContent>
    </Card>

    {#each typeOrder as type}
      <section class="space-y-3">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-foreground">{typeLabels[type]}</h2>
            <p class="text-sm text-muted-foreground">{counts.byType[type]} task(s), {selectedCountFor(type)} selected</p>
          </div>
          {#if rowsByType(type).length > 0}
            <Button variant="outline" size="sm" onclick={() => { if (allSelectedFor(type)) { selected = new Set([...selected].filter((fp) => !rowsByType(type).some((item) => item.filePath === fp))); } else { selectRows(rowsByType(type)); } }} disabled={deleting || triggering}>
              {allSelectedFor(type) ? "Unselect Section" : "Select Section"}
            </Button>
          {/if}
        </div>

        {#if rowsByType(type).length === 0}
          <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">No {typeLabels[type].toLowerCase()} tasks.</div>
        {:else}
          <div class="overflow-x-auto rounded-xl border">
            <Table class="min-w-[1200px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead class="w-12">Select</TableHead>
                  <TableHead class="w-[18%] whitespace-normal">Filename</TableHead>
                  <TableHead class="w-[20%] whitespace-normal">Event</TableHead>
                  <TableHead class="w-[12%] whitespace-normal">Channel / Bot / Chat</TableHead>
                  <TableHead class="w-[14%] whitespace-normal">Schedule</TableHead>
                  <TableHead class="w-[8%] whitespace-normal">Delivery</TableHead>
                  <TableHead class="w-[14%] whitespace-normal">Status</TableHead>
                  <TableHead class="w-[6%] whitespace-normal text-right">Run Count</TableHead>
                  <TableHead class="w-[8%] whitespace-normal">Updated</TableHead>
                  <TableHead class="w-[10%] whitespace-normal">Actions</TableHead>
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
                    <TableCell class="align-top">
                      <div class="min-w-0 space-y-1">
                        <p class="break-words font-medium text-foreground">{item.filename}</p>
                        <p class="break-all text-xs text-muted-foreground">{item.filePath}</p>
                      </div>
                    </TableCell>
                    <TableCell class="align-top">
                      <div class="min-w-0">
                        {#if editingFilePath === item.filePath}
                          <Textarea class="min-h-24" bind:value={editDraft.text} disabled={saving} />
                        {:else if item.text}
                          <div class={expandedText.has(item.filePath) ? "" : "line-clamp-5"}>
                            <p class="break-words text-sm text-foreground">{item.text}</p>
                          </div>
                          {#if (item.text.match(/\n/g) || []).length >= 4 || item.text.length > 200}
                            <button type="button" onclick={() => toggleTextExpand(item.filePath)} class="mt-1 text-xs text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2">
                              {expandedText.has(item.filePath) ? "Show less" : "Show more"}
                            </button>
                          {/if}
                        {:else}
                          <p class="break-words text-sm text-foreground">-</p>
                        {/if}
                      </div>
                    </TableCell>
                    <TableCell class="align-top">
                      <div class="break-words text-xs uppercase tracking-[0.08em] text-muted-foreground">{item.channel}</div>
                      <div class="break-all text-sm text-foreground">{item.botId}</div>
                      <div class="break-all text-xs text-muted-foreground">{item.chatId || "-"}</div>
                      <Badge variant="outline" class="mt-1 whitespace-normal text-[10px]">{item.scope === "workspace" ? "workspace" : "chat scratch"}</Badge>
                    </TableCell>
                    <TableCell class="align-top">
                      <div class="space-y-1">
                        {#if editingFilePath === item.filePath}
                          {#if item.type !== "immediate"}
                            <Input bind:value={editDraft.scheduleText} placeholder={item.type === "periodic" ? "cron: 30 17 * * *" : "ISO datetime"} disabled={saving} />
                          {/if}
                          {#if item.type === "periodic"}
                            <Input bind:value={editDraft.timezone} placeholder="Asia/Shanghai" disabled={saving} />
                          {/if}
                        {:else}
                          <div class="break-words text-sm text-foreground">{item.scheduleText || "-"}</div>
                          {#if item.timezone}
                            <div class="break-all text-xs text-muted-foreground">{item.timezone}</div>
                          {/if}
                        {/if}
                        <div class="text-xs leading-5 text-muted-foreground">created {formatDate(item.createdAt)}</div>
                      </div>
                    </TableCell>
                    <TableCell class="align-top">
                      {#if editingFilePath === item.filePath}
                        <NativeSelect bind:value={editDraft.delivery} disabled={saving}>
                          <NativeSelectOption value="agent">agent</NativeSelectOption>
                          <NativeSelectOption value="text">text</NativeSelectOption>
                        </NativeSelect>
                      {:else}
                        <span class="break-words text-sm text-foreground">{item.delivery}</span>
                      {/if}
                    </TableCell>
                    <TableCell class="align-top">
                      <Badge variant={statusVariant(item.status)} class="whitespace-normal">{item.status}</Badge>
                      {#if item.statusReason}
                        <div class="mt-1 break-words text-xs text-muted-foreground">{item.statusReason}</div>
                      {/if}
                      {#if item.lastTriggeredAt}
                        <div class="mt-1 text-xs leading-5 text-muted-foreground">last {formatDate(item.lastTriggeredAt)}</div>
                      {/if}
                      {#if item.completedAt}
                        <div class="mt-1 text-xs leading-5 text-muted-foreground">done {formatDate(item.completedAt)}</div>
                      {/if}
                      {#if item.lastError}
                        <div class="mt-1">
                          <div class={expandedText.has(`error-${item.filePath}`) ? "" : "line-clamp-3"}>
                            <p class="max-w-xs break-words text-xs text-destructive">{item.lastError}</p>
                          </div>
                          {#if item.lastError.length > 150}
                            <button type="button" onclick={() => toggleTextExpand(`error-${item.filePath}`)} class="text-xs text-destructive/80 hover:text-destructive underline decoration-dotted underline-offset-2">
                              {expandedText.has(`error-${item.filePath}`) ? "Show less" : "Show more"}
                            </button>
                          {/if}
                        </div>
                      {/if}
                    </TableCell>
                    <TableCell class="align-top text-right text-sm">{item.runCount}</TableCell>
                    <TableCell class="align-top text-sm leading-5 text-foreground">{formatDate(item.updatedAt)}</TableCell>
                    <TableCell class="align-top">
                      <div class="flex flex-col gap-2">
                        <Button class="w-full justify-center whitespace-normal" variant="secondary" size="sm" onclick={() => triggerOne(item.filePath)} disabled={deleting || triggering || saving || editingFilePath === item.filePath}>Retry Now</Button>
                        {#if editingFilePath === item.filePath}
                          <Button class="w-full justify-center whitespace-normal" variant="default" size="sm" onclick={() => saveEdit(item)} disabled={saving || deleting || triggering}>{saving ? "Saving..." : "Save"}</Button>
                          <Button class="w-full justify-center whitespace-normal" variant="outline" size="sm" onclick={cancelEdit} disabled={saving}>Cancel</Button>
                        {:else}
                          <Button class="w-full justify-center whitespace-normal" variant="outline" size="sm" onclick={() => beginEdit(item)} disabled={deleting || triggering || saving}>Edit</Button>
                        {/if}
                        <Button class="w-full justify-center whitespace-normal" variant="destructive" size="sm" onclick={() => deleteOne(item.filePath)} disabled={deleting || triggering || saving}>Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        {/if}
      </section>
    {/each}

    {#if diagnostics.length > 0}
      <Card class="border-amber-500/40 bg-amber-500/5">
        <CardHeader><CardTitle class="text-sm text-amber-700 dark:text-amber-400">Diagnostics</CardTitle></CardHeader>
        <CardContent class="space-y-1">
          {#each diagnostics as row}
            <p class="text-xs text-amber-600 dark:text-amber-300">{row}</p>
          {/each}
        </CardContent>
      </Card>
    {/if}
  {/if}
</div>
