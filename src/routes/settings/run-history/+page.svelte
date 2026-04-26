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
    if (outcome === "success") return "border-emerald-500/40 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] text-[color-mix(in_oklab,hsl(146_55%_42%)_84%,var(--foreground))]";
    if (outcome === "partial") return "border-amber-500/40 bg-[color-mix(in_oklab,hsl(38_84%_54%)_10%,var(--card))] text-[color-mix(in_oklab,hsl(38_84%_44%)_78%,var(--foreground))]";
    return "border-[color-mix(in_oklab,var(--destructive)_36%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))] text-[var(--destructive)]";
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
  <header class="wb-hero">
    <div class="wb-hero-copy">
      <p class="wb-eyebrow">Run Reflection</p>
      <h1>Run History</h1>
      <p class="wb-copy">
        Inspect recent agent runs, outcomes, and follow-up suggestions.
      </p>
    </div>
    <div class="wb-hero-actions">
      <Button variant="outline" size="md" on:click={loadRunHistory}>Refresh</Button>
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
      Loading run history...
    </div>
  {:else}
    <section class="wb-summary-strip text-sm sm:grid-cols-4">
      <div><span class="text-[var(--muted-foreground)]">Total:</span> {counts.total}</div>
      <div><span class="text-[var(--muted-foreground)]">Success:</span> {counts.success}</div>
      <div><span class="text-[var(--muted-foreground)]">Partial:</span> {counts.partial}</div>
      <div><span class="text-[var(--muted-foreground)]">Failed:</span> {counts.failed}</div>
    </section>

    {#if diagnostics.length > 0}
      <Alert className="whitespace-pre-wrap">{diagnostics.join("\n")}</Alert>
    {/if}

    {#if items.length === 0}
      <div class="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] px-4 py-3 text-sm text-[var(--foreground)]">
        No run records found yet.
      </div>
    {:else}
      <section class="space-y-4">
        {#each items as item}
          <article class="rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] p-5 text-sm text-[var(--foreground)]">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-base font-semibold">{item.botId} / {item.chatId}</h2>
                  <span class={`rounded-full border px-2 py-0.5 text-xs ${outcomeClass(item.reflectionOutcome)}`}>
                    {item.reflectionOutcome}
                  </span>
                </div>
                <p class="text-xs text-[var(--muted-foreground)]">{formatDate(item.createdAt)} · {formatDuration(item.durationMs)} · {item.runId}</p>
              </div>
              <div class="text-right text-xs text-[var(--muted-foreground)]">
                <div>Result: {item.stopReason}</div>
                <div>Memory used: {item.memorySelectedCount}</div>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_52%,var(--card))] p-3">
                <p class="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Summary</p>
                <p class="mt-2 text-sm text-[var(--foreground)]">{item.reflectionSummary || "No summary"}</p>
                <p class="mt-2 text-xs text-[var(--muted-foreground)]">Next: {item.nextAction || "-"}</p>
              </div>
              <div class="rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_52%,var(--card))] p-3">
                <p class="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Output Snapshot</p>
                <p class="mt-2 whitespace-pre-wrap text-sm text-[var(--foreground)]">{item.finalText || "(empty)"}</p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p class="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Tools</p>
                <p class="mt-1 text-sm text-[var(--foreground)]">{item.toolNames.length > 0 ? item.toolNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Failures</p>
                <p class="mt-1 text-sm text-[var(--foreground)]">{item.failedToolNames.length > 0 ? item.failedToolNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Explicit Skills</p>
                <p class="mt-1 text-sm text-[var(--foreground)]">{item.explicitSkillNames.length > 0 ? item.explicitSkillNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Fallback</p>
                <p class="mt-1 text-sm text-[var(--foreground)]">{item.usedFallbackModel ? "Yes" : "No"}</p>
              </div>
            </div>

            {#if item.modelFailureSummaries.length > 0 || item.skillDraftPath}
              <div class="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_52%,var(--card))] p-3 text-xs text-[var(--muted-foreground)]">
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
