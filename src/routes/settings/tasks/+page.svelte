<script lang="ts">
  import { onMount } from "svelte";

  type TaskType = "one-shot" | "periodic" | "immediate";
  type TaskStatus = "pending" | "completed" | "skipped" | "error";
  type TaskScope = "workspace" | "chat-scratch";

  interface TaskItem {
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
  }

  let loading = true;
  let error = "";
  let message = "";
  let dataRoot = "";
  let diagnostics: string[] = [];
  let items: TaskItem[] = [];
  let counts: Counts = {
    total: 0,
    byType: { "one-shot": 0, periodic: 0, immediate: 0 },
    byStatus: { pending: 0, completed: 0, skipped: 0, error: 0 },
    byScope: { workspace: 0, chatScratch: 0 }
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
    if (status === "completed") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    if (status === "error") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    if (status === "skipped") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  }

  function rowsByType(type: TaskType): TaskItem[] {
    return items.filter((item) => item.type === type);
  }

  async function loadTasks(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/tasks");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load tasks");
      dataRoot = String(data.dataRoot ?? "");
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      items = Array.isArray(data.items) ? data.items : [];
      counts = data.counts ?? counts;
      message = `Loaded ${items.length} task(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadTasks);
</script>

<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:block">
      <nav class="space-y-1 text-sm">
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/">Chat</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings">Settings</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/ai">AI</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/telegram">Telegram</a>
        <a class="block rounded-lg bg-white/15 px-3 py-2 font-medium text-white" href="/settings/tasks">Tasks</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/skills">Skills</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/plugins">Plugins</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/memory">Memory</a>
      </nav>
    </aside>

    <section class="min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
      <div class="mx-auto max-w-7xl space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-2xl font-semibold">Tasks</h1>
            <p class="text-sm text-slate-400">Inspect scheduled event tasks grouped by type and current execution state.</p>
          </div>
          <button
            class="cursor-pointer rounded-lg border border-white/20 bg-[#2b2b2b] px-3 py-2 text-sm hover:bg-[#343434]"
            on:click={loadTasks}
          >
            Refresh
          </button>
        </div>

        {#if message}
          <p class="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">{message}</p>
        {/if}
        {#if error}
          <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
        {/if}

        {#if loading}
          <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">Loading tasks...</div>
        {:else}
          <section class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
            <div><span class="text-slate-400">Data root:</span> {dataRoot || "(unknown)"}</div>
            <div><span class="text-slate-400">Total tasks:</span> {counts.total}</div>
            <div><span class="text-slate-400">Workspace tasks:</span> {counts.byScope.workspace}</div>
            <div><span class="text-slate-400">Chat scratch tasks:</span> {counts.byScope.chatScratch}</div>
            <div><span class="text-slate-400">Pending:</span> {counts.byStatus.pending}</div>
            <div><span class="text-slate-400">Completed:</span> {counts.byStatus.completed}</div>
            <div><span class="text-slate-400">Skipped:</span> {counts.byStatus.skipped}</div>
            <div><span class="text-slate-400">Error:</span> {counts.byStatus.error}</div>
          </section>

          {#each typeOrder as type}
            <section class="space-y-3">
              <div class="flex items-end justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold">{typeLabels[type]}</h2>
                  <p class="text-sm text-slate-400">{counts.byType[type]} task(s)</p>
                </div>
              </div>

              {#if rowsByType(type).length === 0}
                <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">No {typeLabels[type].toLowerCase()} tasks.</div>
              {:else}
                <div class="overflow-x-auto rounded-xl border border-white/15 bg-[#2b2b2b]">
                  <table class="min-w-full text-left text-sm">
                    <thead class="border-b border-white/10 bg-white/5 text-slate-300">
                      <tr>
                        <th class="px-3 py-3 font-medium">Task</th>
                        <th class="px-3 py-3 font-medium">Bot / Chat</th>
                        <th class="px-3 py-3 font-medium">Schedule</th>
                        <th class="px-3 py-3 font-medium">Delivery</th>
                        <th class="px-3 py-3 font-medium">Status</th>
                        <th class="px-3 py-3 font-medium">Run Count</th>
                        <th class="px-3 py-3 font-medium">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each rowsByType(type) as item (item.filePath)}
                        <tr class="border-b border-white/10 align-top last:border-b-0">
                          <td class="px-3 py-3">
                            <div class="max-w-[28rem] space-y-1">
                              <p class="font-medium text-slate-100">{item.filename}</p>
                              <p class="text-slate-300">{item.text || "-"}</p>
                              <p class="text-xs text-slate-500">{item.filePath}</p>
                            </div>
                          </td>
                          <td class="px-3 py-3 text-slate-300">
                            <div>{item.botId}</div>
                            <div class="text-xs text-slate-500">{item.chatId || "-"}</div>
                            <div class="mt-1 text-xs text-slate-500">{item.scope === "workspace" ? "workspace" : "chat scratch"}</div>
                          </td>
                          <td class="px-3 py-3 text-slate-300">
                            <div>{item.scheduleText || "-"}</div>
                            {#if item.timezone}
                              <div class="text-xs text-slate-500">{item.timezone}</div>
                            {/if}
                            <div class="mt-1 text-xs text-slate-500">created {formatDate(item.createdAt)}</div>
                          </td>
                          <td class="px-3 py-3 text-slate-300">{item.delivery}</td>
                          <td class="px-3 py-3">
                            <div class={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusClass(item.status)}`}>{item.status}</div>
                            {#if item.statusReason}
                              <div class="mt-1 text-xs text-slate-500">{item.statusReason}</div>
                            {/if}
                            {#if item.lastTriggeredAt}
                              <div class="mt-1 text-xs text-slate-500">last {formatDate(item.lastTriggeredAt)}</div>
                            {/if}
                            {#if item.completedAt}
                              <div class="mt-1 text-xs text-slate-500">done {formatDate(item.completedAt)}</div>
                            {/if}
                            {#if item.lastError}
                              <div class="mt-1 max-w-xs text-xs text-rose-300">{item.lastError}</div>
                            {/if}
                          </td>
                          <td class="px-3 py-3 text-slate-300">{item.runCount}</td>
                          <td class="px-3 py-3 text-slate-300">{formatDate(item.updatedAt)}</td>
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
      </div>
    </section>
  </div>
</main>
