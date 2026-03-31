<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  type TaskType = "one-shot" | "periodic" | "immediate";
  type TaskStatus = "pending" | "running" | "completed" | "skipped" | "error";
  type TaskScope = "workspace" | "chat-scratch";
  type TaskChannel = "telegram" | "feishu" | "qq" | "weixin";

  interface TaskItem {
    channel: TaskChannel;
    botId: string;
    chatId: string;
    scope: TaskScope;
    filename: string;
    filePath: string;
    type: TaskType;
    delivery: string;
    text: string;
    scheduleText: string;
    timezone: string;
    status: TaskStatus;
    statusReason: string;
    lastError: string;
    runCount: number;
    completedAt: string;
    lastTriggeredAt: string;
    updatedAt: string;
    createdAt: string;
  }

  interface Counts {
    total: number;
    byType: Record<TaskType, number>;
    byStatus: Record<TaskStatus, number>;
    byScope: { workspace: number; chatScratch: number };
    byChannel: Record<TaskChannel, number>;
  }

  interface DeleteResult {
    deleted?: string[];
    triggered?: string[];
    failed?: Array<{ filePath: string; reason: string }>;
  }

  interface UpdateResult {
    updated?: string;
    ok?: boolean;
    error?: string;
  }

  interface TaskEditDraft {
    text: string;
    delivery: string;
    scheduleText: string;
    timezone: string;
  }

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
  let counts: Counts = {
    total: 0,
    byType: { "one-shot": 0, periodic: 0, immediate: 0 },
    byStatus: { pending: 0, running: 0, completed: 0, skipped: 0, error: 0 },
    byScope: { workspace: 0, chatScratch: 0 },
    byChannel: { telegram: 0, feishu: 0, qq: 0, weixin: 0 }
  };

  const typeOrder: TaskType[] = ["one-shot", "periodic", "immediate"];
  const typeLabels: Record<TaskType, string> = {
    "one-shot": "One-shot",
    periodic: "Periodic",
    immediate: "Immediate"
  };

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  function statusClass(status: TaskStatus): string {
    if (status === "running") {
      return "border-violet-500/40 bg-violet-500/10 text-violet-300";
    }
    if (status === "completed") {
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    }
    if (status === "error") {
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    }
    if (status === "skipped") {
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    }
    return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  }

  function rowsByType(type: TaskType): TaskItem[] {
    return items.filter((item) => item.type === type);
  }

  function beginEdit(item: TaskItem): void {
    editingFilePath = item.filePath;
    editDraft = {
      text: item.text || "",
      delivery: item.delivery || "agent",
      scheduleText: item.scheduleText || "",
      timezone: item.timezone || ""
    };
    error = "";
    message = "";
  }

  function cancelEdit(): void {
    editingFilePath = "";
    editDraft = { text: "", delivery: "agent", scheduleText: "", timezone: "" };
  }

  async function saveEdit(item: TaskItem): Promise<void> {
    if (!editingFilePath || editingFilePath !== item.filePath || saving) return;
    saving = true;
    error = "";
    try {
      const patch: Record<string, string> = {
        text: editDraft.text,
        delivery: editDraft.delivery
      };
      if (item.type === "one-shot") {
        patch.at = editDraft.scheduleText;
      }
      if (item.type === "periodic") {
        patch.schedule = editDraft.scheduleText;
        patch.timezone = editDraft.timezone;
      }

      const res = await fetch("/api/settings/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          filePath: item.filePath,
          patch
        })
      });

      const data = (await res.json()) as UpdateResult;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to update task");
      }

      message = "Task updated.";
      cancelEdit();
      await loadTasks();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function toggleSelection(filePath: string): void {
    const next = new Set(selected);
    if (next.has(filePath)) {
      next.delete(filePath);
    } else {
      next.add(filePath);
    }
    selected = next;
  }

  function clearSelection(): void {
    selected = new Set();
  }

  function selectRows(rows: TaskItem[]): void {
    const next = new Set(selected);
    for (const row of rows) {
      next.add(row.filePath);
    }
    selected = next;
  }

  function selectAllTasks(): void {
    selected = new Set(items.map((item) => item.filePath));
  }

  function selectedCountFor(type: TaskType): number {
    return rowsByType(type).filter((item) => selected.has(item.filePath)).length;
  }

  function allSelectedFor(type: TaskType): boolean {
    const rows = rowsByType(type);
    return rows.length > 0 && rows.every((item) => selected.has(item.filePath));
  }

  async function loadTasks(): Promise<void> {
    loading = true;
    error = "";
    try {
      const res = await fetch("/api/settings/tasks");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load tasks");
      dataRoot = String(data.dataRoot ?? "");
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      items = Array.isArray(data.items) ? data.items : [];
      counts = data.counts
        ? {
            total: Number(data.counts.total ?? 0),
            byType: data.counts.byType ?? counts.byType,
            byStatus: data.counts.byStatus ?? counts.byStatus,
            byScope: data.counts.byScope ?? counts.byScope,
            byChannel: data.counts.byChannel ?? counts.byChannel
          }
        : counts;
      selected = new Set([...selected].filter((filePath) => items.some((item) => item.filePath === filePath)));
      message = `Loaded ${items.length} task(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function deleteTasks(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0 || deleting) return;

    deleting = true;
    error = "";
    try {
      const res = await fetch("/api/settings/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "delete",
          filePaths
        })
      });

      const data = (await res.json()) as DeleteResult & { ok?: boolean; error?: string };
      const deleted = Array.isArray(data.deleted) ? data.deleted : [];
      const failed = Array.isArray(data.failed) ? data.failed : [];

      if (deleted.length > 0) {
        selected = new Set([...selected].filter((filePath) => !deleted.includes(filePath)));
      }

      if (failed.length > 0) {
        const details = failed.map((item) => `${item.filePath} (${item.reason})`).join("; ");
        throw new Error(`Deleted ${deleted.length} task(s), but some failed: ${details}`);
      }

      message = `Deleted ${deleted.length} task(s).`;
      await loadTasks();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await loadTasks();
    } finally {
      deleting = false;
    }
  }

  function deleteOne(filePath: string): Promise<void> {
    return deleteTasks([filePath]);
  }

  function deleteSelected(): Promise<void> {
    return deleteTasks([...selected]);
  }

  async function triggerTasks(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0 || triggering) return;

    triggering = true;
    error = "";
    try {
      const res = await fetch("/api/settings/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "trigger",
          filePaths
        })
      });

      const data = (await res.json()) as DeleteResult & { ok?: boolean; error?: string };
      const triggered = Array.isArray(data.triggered) ? data.triggered : [];
      const failed = Array.isArray(data.failed) ? data.failed : [];

      if (failed.length > 0) {
        const details = failed.map((item) => `${item.filePath} (${item.reason})`).join("; ");
        throw new Error(`Triggered ${triggered.length} task(s), but some failed: ${details}`);
      }

      message = `Triggered ${triggered.length} task(s).`;
      await loadTasks();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await loadTasks();
    } finally {
      triggering = false;
    }
  }

  function triggerOne(filePath: string): Promise<void> {
    return triggerTasks([filePath]);
  }

  function triggerSelected(): Promise<void> {
    return triggerTasks([...selected]);
  }

  onMount(loadTasks);
</script>

<PageShell widthClass="max-w-7xl" gapClass="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Tasks</h1>
      <p class="text-sm text-slate-400">
        Inspect scheduled event tasks, select stale entries, and remove them in batches.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="md" on:click={loadTasks} disabled={loading || deleting || triggering}>
        Refresh
      </Button>
      <Button
        variant="secondary"
        size="md"
        on:click={triggerSelected}
        disabled={selected.size === 0 || deleting || loading || triggering || saving}
      >
        {triggering ? "Sending..." : `Send Selected (${selected.size})`}
      </Button>
      <Button
        variant="destructive"
        size="md"
        on:click={deleteSelected}
        disabled={selected.size === 0 || deleting || loading || triggering || saving}
      >
        {deleting ? "Deleting..." : `Delete Selected (${selected.size})`}
      </Button>
    </div>
  </div>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading tasks...
    </div>
  {:else}
    <section class="grid gap-3 rounded-[1.25rem] border border-white/15 bg-[linear-gradient(135deg,rgba(20,26,38,0.95),rgba(40,26,24,0.92))] p-4 text-sm text-slate-300 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <span class="text-slate-400">Data root:</span>
        {dataRoot || "(unknown)"}
      </div>
      <div>
        <span class="text-slate-400">Total tasks:</span>
        {counts.total}
      </div>
      <div>
        <span class="text-slate-400">Workspace tasks:</span>
        {counts.byScope.workspace}
      </div>
      <div>
        <span class="text-slate-400">Chat scratch tasks:</span>
        {counts.byScope.chatScratch}
      </div>
      <div>
        <span class="text-slate-400">Pending:</span>
        {counts.byStatus.pending}
      </div>
      <div>
        <span class="text-slate-400">Running:</span>
        {counts.byStatus.running}
      </div>
      <div>
        <span class="text-slate-400">Completed:</span>
        {counts.byStatus.completed}
      </div>
      <div>
        <span class="text-slate-400">Skipped:</span>
        {counts.byStatus.skipped}
      </div>
      <div>
        <span class="text-slate-400">Error:</span>
        {counts.byStatus.error}
      </div>
      <div>
        <span class="text-slate-400">Telegram:</span>
        {counts.byChannel.telegram}
      </div>
      <div>
        <span class="text-slate-400">Feishu:</span>
        {counts.byChannel.feishu}
      </div>
      <div>
        <span class="text-slate-400">QQ:</span>
        {counts.byChannel.qq}
      </div>
      <div>
        <span class="text-slate-400">WeChat:</span>
        {counts.byChannel.weixin}
      </div>
    </section>

    <section class="flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border border-white/10 bg-[#171b23] px-4 py-3 text-sm text-slate-300">
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-400">
          Batch Operations
        </span>
        <span>{selected.size} selected</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="md" on:click={selectAllTasks} disabled={items.length === 0 || deleting || triggering}>
          Select All
        </Button>
        <Button variant="outline" size="md" on:click={clearSelection} disabled={selected.size === 0 || deleting || triggering || saving}>
          Clear Selection
        </Button>
        <Button variant="secondary" size="md" on:click={triggerSelected} disabled={selected.size === 0 || deleting || triggering || saving}>
          Send Selected
        </Button>
        <Button variant="destructive" size="md" on:click={deleteSelected} disabled={selected.size === 0 || deleting || triggering || saving}>
          Delete Selected
        </Button>
      </div>
    </section>

    {#each typeOrder as type}
      <section class="space-y-3">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">{typeLabels[type]}</h2>
            <p class="text-sm text-slate-400">
              {counts.byType[type]} task(s), {selectedCountFor(type)} selected
            </p>
          </div>
          {#if rowsByType(type).length > 0}
            <Button
              variant="outline"
              size="md"
              on:click={() => {
                if (allSelectedFor(type)) {
                  selected = new Set([...selected].filter((filePath) => !rowsByType(type).some((item) => item.filePath === filePath)));
                } else {
                  selectRows(rowsByType(type));
                }
              }}
              disabled={deleting || triggering}
            >
              {allSelectedFor(type) ? "Unselect Section" : "Select Section"}
            </Button>
          {/if}
        </div>

        {#if rowsByType(type).length === 0}
          <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
            No {typeLabels[type].toLowerCase()} tasks.
          </div>
        {:else}
          <div class="overflow-x-auto rounded-[1.25rem] border border-white/15 bg-[#11161e] shadow-[0_18px_60px_rgba(0,0,0,0.25)]">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] text-slate-300">
                <tr>
                  <th class="px-3 py-3 font-medium">Select</th>
                  <th class="px-3 py-3 font-medium">Task</th>
                  <th class="px-3 py-3 font-medium">Channel / Bot / Chat</th>
                  <th class="px-3 py-3 font-medium">Schedule</th>
                  <th class="px-3 py-3 font-medium">Delivery</th>
                  <th class="px-3 py-3 font-medium">Status</th>
                  <th class="px-3 py-3 font-medium">Run Count</th>
                  <th class="px-3 py-3 font-medium">Updated</th>
                  <th class="px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each rowsByType(type) as item (item.filePath)}
                  <tr class={`border-b border-white/10 align-top last:border-b-0 ${selected.has(item.filePath) ? "bg-white/[0.04]" : ""}`}>
                    <td class="px-3 py-3">
                      <input
                        type="checkbox"
                        class="h-4 w-4 cursor-pointer rounded border-white/20 bg-transparent"
                        checked={selected.has(item.filePath)}
                        on:change={() => toggleSelection(item.filePath)}
                        disabled={deleting || triggering || saving}
                      />
                    </td>
                    <td class="px-3 py-3">
                      <div class="max-w-[28rem] space-y-1">
                        <p class="font-medium text-slate-100">{item.filename}</p>
                        {#if editingFilePath === item.filePath}
                          <textarea
                            class="min-h-24 w-full rounded-md border border-white/20 bg-black/30 px-2 py-1 text-sm text-slate-100"
                            bind:value={editDraft.text}
                            disabled={saving}
                          ></textarea>
                        {:else}
                          <p class="text-slate-300">{item.text || "-"}</p>
                        {/if}
                        <p class="text-xs text-slate-500">{item.filePath}</p>
                      </div>
                    </td>
                    <td class="px-3 py-3 text-slate-300">
                      <div class="text-xs uppercase tracking-[0.08em] text-slate-400">{item.channel}</div>
                      <div>{item.botId}</div>
                      <div class="text-xs text-slate-500">{item.chatId || "-"}</div>
                      <div class="mt-1 text-xs text-slate-500">
                        {item.scope === "workspace" ? "workspace" : "chat scratch"}
                      </div>
                    </td>
                    <td class="px-3 py-3 text-slate-300">
                      {#if editingFilePath === item.filePath}
                        {#if item.type !== "immediate"}
                          <input
                            class="w-full rounded-md border border-white/20 bg-black/30 px-2 py-1 text-sm text-slate-100"
                            bind:value={editDraft.scheduleText}
                            placeholder={item.type === "periodic" ? "cron: 30 17 * * *" : "ISO datetime"}
                            disabled={saving}
                          />
                        {:else}
                          <div>-</div>
                        {/if}
                        {#if item.type === "periodic"}
                          <input
                            class="mt-1 w-full rounded-md border border-white/20 bg-black/30 px-2 py-1 text-sm text-slate-100"
                            bind:value={editDraft.timezone}
                            placeholder="Asia/Shanghai"
                            disabled={saving}
                          />
                        {/if}
                      {:else}
                        <div>{item.scheduleText || "-"}</div>
                        {#if item.timezone}
                          <div class="text-xs text-slate-500">{item.timezone}</div>
                        {/if}
                      {/if}
                      <div class="mt-1 text-xs text-slate-500">
                        created {formatDate(item.createdAt)}
                      </div>
                    </td>
                    <td class="px-3 py-3 text-slate-300">
                      {#if editingFilePath === item.filePath}
                        <select
                          class="rounded-md border border-white/20 bg-black/30 px-2 py-1 text-sm text-slate-100"
                          bind:value={editDraft.delivery}
                          disabled={saving}
                        >
                          <option value="agent">agent</option>
                          <option value="text">text</option>
                        </select>
                      {:else}
                        {item.delivery}
                      {/if}
                    </td>
                    <td class="px-3 py-3">
                      <div class={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusClass(item.status)}`}>
                        {item.status}
                      </div>
                      {#if item.statusReason}
                        <div class="mt-1 text-xs text-slate-500">{item.statusReason}</div>
                      {/if}
                      {#if item.lastTriggeredAt}
                        <div class="mt-1 text-xs text-slate-500">
                          last {formatDate(item.lastTriggeredAt)}
                        </div>
                      {/if}
                      {#if item.completedAt}
                        <div class="mt-1 text-xs text-slate-500">
                          done {formatDate(item.completedAt)}
                        </div>
                      {/if}
                      {#if item.lastError}
                        <div class="mt-1 max-w-xs text-xs text-rose-300">{item.lastError}</div>
                      {/if}
                    </td>
                    <td class="px-3 py-3 text-slate-300">{item.runCount}</td>
                    <td class="px-3 py-3 text-slate-300">{formatDate(item.updatedAt)}</td>
                    <td class="px-3 py-3">
                      <div class="flex flex-col gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          on:click={() => triggerOne(item.filePath)}
                          disabled={deleting || triggering || saving || editingFilePath === item.filePath}
                        >
                          Retry Now
                        </Button>
                        {#if editingFilePath === item.filePath}
                          <Button
                            variant="default"
                            size="sm"
                            on:click={() => saveEdit(item)}
                            disabled={saving || deleting || triggering}
                          >
                            {saving ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            on:click={cancelEdit}
                            disabled={saving}
                          >
                            Cancel
                          </Button>
                        {:else}
                          <Button
                            variant="outline"
                            size="sm"
                            on:click={() => beginEdit(item)}
                            disabled={deleting || triggering || saving}
                          >
                            Edit
                          </Button>
                        {/if}
                        <Button
                          variant="destructive"
                          size="sm"
                          on:click={() => deleteOne(item.filePath)}
                          disabled={deleting || triggering || saving}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/each}

    {#if diagnostics.length > 0}
      <section class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
        <h2 class="text-sm font-semibold text-amber-300">Diagnostics</h2>
        {#each diagnostics as row}
          <p class="text-xs text-amber-200">{row}</p>
        {/each}
      </section>
    {/if}
  {/if}
</PageShell>
