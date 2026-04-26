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
      return "border-emerald-500/40 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] text-[color-mix(in_oklab,hsl(146_55%_42%)_84%,var(--foreground))]";
    }
    if (status === "error") {
      return "border-[color-mix(in_oklab,var(--destructive)_36%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))] text-[var(--destructive)]";
    }
    if (status === "skipped") {
      return "border-amber-500/40 bg-[color-mix(in_oklab,hsl(38_84%_54%)_10%,var(--card))] text-[color-mix(in_oklab,hsl(38_84%_44%)_78%,var(--foreground))]";
    }
    return "border-[color-mix(in_oklab,var(--primary)_34%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] text-[color-mix(in_oklab,var(--primary)_74%,var(--foreground))]";
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
  <header class="wb-hero">
    <div class="wb-hero-copy">
      <p class="wb-eyebrow">Event Runtime</p>
      <h1>Tasks</h1>
      <p class="wb-copy">
        Inspect scheduled event tasks, select stale entries, and remove them in batches.
      </p>
    </div>
    <div class="wb-hero-actions">
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
  </header>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  {#if loading}
    <div class="wb-empty-state text-left">
      Loading tasks...
    </div>
  {:else}
    <section class="wb-summary-strip text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <span class="text-[var(--muted-foreground)]">Data root:</span>
        {dataRoot || "(unknown)"}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Total tasks:</span>
        {counts.total}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Workspace tasks:</span>
        {counts.byScope.workspace}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Chat scratch tasks:</span>
        {counts.byScope.chatScratch}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Pending:</span>
        {counts.byStatus.pending}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Running:</span>
        {counts.byStatus.running}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Completed:</span>
        {counts.byStatus.completed}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Skipped:</span>
        {counts.byStatus.skipped}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Error:</span>
        {counts.byStatus.error}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Telegram:</span>
        {counts.byChannel.telegram}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">Feishu:</span>
        {counts.byChannel.feishu}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">QQ:</span>
        {counts.byChannel.qq}
      </div>
      <div>
        <span class="text-[var(--muted-foreground)]">WeChat:</span>
        {counts.byChannel.weixin}
      </div>
    </section>

    <section class="wb-toolbar text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-full border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_42%,var(--card))] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
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
            <p class="text-sm text-[var(--muted-foreground)]">
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
          <div class="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] px-4 py-3 text-sm text-[var(--foreground)]">
            No {typeLabels[type].toLowerCase()} tasks.
          </div>
        {:else}
          <div class="overflow-x-auto rounded-[1.25rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_92%,transparent)] shadow-[0_18px_60px_rgba(0,0,0,0.25)]">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[linear-gradient(90deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] text-[var(--foreground)]">
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
                  <tr class={`border-b border-[color-mix(in_oklab,var(--border)_78%,transparent)] align-top last:border-b-0 ${selected.has(item.filePath) ? "bg-white/[0.04]" : ""}`}>
                    <td class="px-3 py-3">
                      <input
                        type="checkbox"
                        class="h-4 w-4 cursor-pointer rounded border-[color-mix(in_oklab,var(--border)_82%,transparent)] bg-transparent"
                        checked={selected.has(item.filePath)}
                        on:change={() => toggleSelection(item.filePath)}
                        disabled={deleting || triggering || saving}
                      />
                    </td>
                    <td class="px-3 py-3">
                      <div class="max-w-[28rem] space-y-1">
                        <p class="font-medium text-[var(--foreground)]">{item.filename}</p>
                        {#if editingFilePath === item.filePath}
                          <textarea
                            class="min-h-24 w-full rounded-md border border-[color-mix(in_oklab,var(--border)_82%,transparent)] bg-[color-mix(in_oklab,var(--muted)_48%,var(--card))] px-2 py-1 text-sm text-[var(--foreground)]"
                            bind:value={editDraft.text}
                            disabled={saving}
                          ></textarea>
                        {:else}
                          <p class="text-[var(--foreground)]">{item.text || "-"}</p>
                        {/if}
                        <p class="text-xs text-[var(--muted-foreground)]">{item.filePath}</p>
                      </div>
                    </td>
                    <td class="px-3 py-3 text-[var(--foreground)]">
                      <div class="text-xs uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{item.channel}</div>
                      <div>{item.botId}</div>
                      <div class="text-xs text-[var(--muted-foreground)]">{item.chatId || "-"}</div>
                      <div class="mt-1 text-xs text-[var(--muted-foreground)]">
                        {item.scope === "workspace" ? "workspace" : "chat scratch"}
                      </div>
                    </td>
                    <td class="px-3 py-3 text-[var(--foreground)]">
                      {#if editingFilePath === item.filePath}
                        {#if item.type !== "immediate"}
                          <input
                            class="w-full rounded-md border border-[color-mix(in_oklab,var(--border)_82%,transparent)] bg-[color-mix(in_oklab,var(--muted)_48%,var(--card))] px-2 py-1 text-sm text-[var(--foreground)]"
                            bind:value={editDraft.scheduleText}
                            placeholder={item.type === "periodic" ? "cron: 30 17 * * *" : "ISO datetime"}
                            disabled={saving}
                          />
                        {:else}
                          <div>-</div>
                        {/if}
                        {#if item.type === "periodic"}
                          <input
                            class="mt-1 w-full rounded-md border border-[color-mix(in_oklab,var(--border)_82%,transparent)] bg-[color-mix(in_oklab,var(--muted)_48%,var(--card))] px-2 py-1 text-sm text-[var(--foreground)]"
                            bind:value={editDraft.timezone}
                            placeholder="Asia/Shanghai"
                            disabled={saving}
                          />
                        {/if}
                      {:else}
                        <div>{item.scheduleText || "-"}</div>
                        {#if item.timezone}
                          <div class="text-xs text-[var(--muted-foreground)]">{item.timezone}</div>
                        {/if}
                      {/if}
                      <div class="mt-1 text-xs text-[var(--muted-foreground)]">
                        created {formatDate(item.createdAt)}
                      </div>
                    </td>
                    <td class="px-3 py-3 text-[var(--foreground)]">
                      {#if editingFilePath === item.filePath}
                        <select
                          class="rounded-md border border-[color-mix(in_oklab,var(--border)_82%,transparent)] bg-[color-mix(in_oklab,var(--muted)_48%,var(--card))] px-2 py-1 text-sm text-[var(--foreground)]"
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
                        <div class="mt-1 text-xs text-[var(--muted-foreground)]">{item.statusReason}</div>
                      {/if}
                      {#if item.lastTriggeredAt}
                        <div class="mt-1 text-xs text-[var(--muted-foreground)]">
                          last {formatDate(item.lastTriggeredAt)}
                        </div>
                      {/if}
                      {#if item.completedAt}
                        <div class="mt-1 text-xs text-[var(--muted-foreground)]">
                          done {formatDate(item.completedAt)}
                        </div>
                      {/if}
                      {#if item.lastError}
                        <div class="mt-1 max-w-xs text-xs text-[var(--destructive)]">{item.lastError}</div>
                      {/if}
                    </td>
                    <td class="px-3 py-3 text-[var(--foreground)]">{item.runCount}</td>
                    <td class="px-3 py-3 text-[var(--foreground)]">{formatDate(item.updatedAt)}</td>
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
      <section class="space-y-2 rounded-xl border border-amber-500/40 bg-[color-mix(in_oklab,hsl(38_84%_54%)_10%,var(--card))] p-4">
        <h2 class="text-sm font-semibold text-[color-mix(in_oklab,hsl(38_84%_44%)_78%,var(--foreground))]">Diagnostics</h2>
        {#each diagnostics as row}
          <p class="text-xs text-[color-mix(in_oklab,hsl(38_84%_44%)_72%,var(--foreground))]">{row}</p>
        {/each}
      </section>
    {/if}
  {/if}
</PageShell>
