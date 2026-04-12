<script lang="ts">
  import { onMount } from "svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import Button from "$lib/ui/Button.svelte";
  import PageShell from "$lib/ui/PageShell.svelte";

  interface RunHistoryItem {
    runId: string;
    createdAt: string;
    botId: string;
    chatId: string;
    stopReason: "stop" | "aborted" | "error";
    durationMs: number;
    finalText: string;
    toolNames: string[];
    failedToolNames: string[];
    explicitSkillNames: string[];
    usedFallbackModel: boolean;
    modelFailureSummaries: string[];
    reflectionOutcome: "success" | "partial" | "failed";
    reflectionSummary: string;
    nextAction: string;
    memorySelectedCount: number;
    skillDraftPath: string;
  }

  interface Counts {
    total: number;
    success: number;
    partial: number;
    failed: number;
  }

  let loading = true;
  let error = "";
  let message = "";
  let items: RunHistoryItem[] = [];
  let diagnostics: string[] = [];
  let counts: Counts = { total: 0, success: 0, partial: 0, failed: 0 };

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

  function formatDuration(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return "-";
    return `${Math.max(1, Math.round(durationMs / 1000))} 秒`;
  }

  function outcomeClass(outcome: RunHistoryItem["reflectionOutcome"]): string {
    if (outcome === "success") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    if (outcome === "partial") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  }

  async function loadRunHistory(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/run-history");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load run history");
      items = Array.isArray(data.items) ? data.items : [];
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      counts = {
        total: Number(data.counts?.total ?? 0),
        success: Number(data.counts?.success ?? 0),
        partial: Number(data.counts?.partial ?? 0),
        failed: Number(data.counts?.failed ?? 0)
      };
      message = `Loaded ${items.length} run record(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadRunHistory);
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Run History</h1>
      <p class="text-sm text-slate-400">
        Inspect recent agent runs, outcomes, and follow-up suggestions.
      </p>
    </div>
    <Button variant="outline" size="md" on:click={loadRunHistory}>Refresh</Button>
  </div>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading run history...
    </div>
  {:else}
    <section class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 text-sm text-slate-300 sm:grid-cols-4">
      <div><span class="text-slate-400">Total:</span> {counts.total}</div>
      <div><span class="text-slate-400">Success:</span> {counts.success}</div>
      <div><span class="text-slate-400">Partial:</span> {counts.partial}</div>
      <div><span class="text-slate-400">Failed:</span> {counts.failed}</div>
    </section>

    {#if diagnostics.length > 0}
      <Alert className="whitespace-pre-wrap">{diagnostics.join("\n")}</Alert>
    {/if}

    {#if items.length === 0}
      <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
        No run records found yet.
      </div>
    {:else}
      <section class="space-y-4">
        {#each items as item}
          <article class="rounded-2xl border border-white/15 bg-[#2b2b2b] p-5 text-sm text-slate-200">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-base font-semibold">{item.botId} / {item.chatId}</h2>
                  <span class={`rounded-full border px-2 py-0.5 text-xs ${outcomeClass(item.reflectionOutcome)}`}>
                    {item.reflectionOutcome}
                  </span>
                </div>
                <p class="text-xs text-slate-400">{formatDate(item.createdAt)} · {formatDuration(item.durationMs)} · {item.runId}</p>
              </div>
              <div class="text-right text-xs text-slate-400">
                <div>Result: {item.stopReason}</div>
                <div>Memory used: {item.memorySelectedCount}</div>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl border border-white/10 bg-black/10 p-3">
                <p class="text-xs uppercase tracking-wide text-slate-400">Summary</p>
                <p class="mt-2 text-sm text-slate-200">{item.reflectionSummary || "No summary"}</p>
                <p class="mt-2 text-xs text-slate-400">Next: {item.nextAction || "-"}</p>
              </div>
              <div class="rounded-xl border border-white/10 bg-black/10 p-3">
                <p class="text-xs uppercase tracking-wide text-slate-400">Output Snapshot</p>
                <p class="mt-2 whitespace-pre-wrap text-sm text-slate-300">{item.finalText || "(empty)"}</p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Tools</p>
                <p class="mt-1 text-sm text-slate-300">{item.toolNames.length > 0 ? item.toolNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Failures</p>
                <p class="mt-1 text-sm text-slate-300">{item.failedToolNames.length > 0 ? item.failedToolNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Explicit Skills</p>
                <p class="mt-1 text-sm text-slate-300">{item.explicitSkillNames.length > 0 ? item.explicitSkillNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Fallback</p>
                <p class="mt-1 text-sm text-slate-300">{item.usedFallbackModel ? "Yes" : "No"}</p>
              </div>
            </div>

            {#if item.modelFailureSummaries.length > 0 || item.skillDraftPath}
              <div class="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-xs text-slate-400">
                {#if item.modelFailureSummaries.length > 0}
                  <p>Model issues: {item.modelFailureSummaries.join(" | ")}</p>
                {/if}
                {#if item.skillDraftPath}
                  <p class="mt-1">Saved draft: {item.skillDraftPath}</p>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </section>
    {/if}
  {/if}
</PageShell>
