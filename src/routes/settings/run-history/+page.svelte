<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

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

  function outcomeVariant(outcome: RunHistoryItem["reflectionOutcome"]): "default" | "secondary" | "destructive" {
    if (outcome === "success") return "default";
    if (outcome === "partial") return "secondary";
    return "destructive";
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

<div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Run Reflection</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Run History</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Inspect recent agent runs, outcomes, and follow-up suggestions.
      </p>
    </div>
  </header>

  <div class="flex items-center gap-2">
    <Button variant="outline" onclick={loadRunHistory}>Refresh</Button>
  </div>

  {#if message}
    <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
  {/if}
  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading run history...</p>
  {:else}
    <div class="flex flex-wrap gap-3 text-sm">
      <Badge variant="outline">Total: {counts.total}</Badge>
      <Badge variant="default">Success: {counts.success}</Badge>
      <Badge variant="secondary">Partial: {counts.partial}</Badge>
      <Badge variant="destructive">Failed: {counts.failed}</Badge>
    </div>

    {#if diagnostics.length > 0}
      <Alert variant="default"><AlertDescription class="whitespace-pre-wrap">{diagnostics.join("\n")}</AlertDescription></Alert>
    {/if}

    {#if items.length === 0}
      <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        No run records found yet.
      </div>
    {:else}
      <div class="space-y-4">
        {#each items as item}
          <article class="rounded-2xl border bg-card/60 p-5 text-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-base font-semibold text-foreground">{item.botId} / {item.chatId}</h2>
                  <Badge variant={outcomeVariant(item.reflectionOutcome)}>{item.reflectionOutcome}</Badge>
                </div>
                <p class="text-xs text-muted-foreground">{formatDate(item.createdAt)} · {formatDuration(item.durationMs)} · {item.runId}</p>
              </div>
              <div class="text-right text-xs text-muted-foreground">
                <div>Result: {item.stopReason}</div>
                <div>Memory used: {item.memorySelectedCount}</div>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl border bg-muted/40 p-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
                <p class="mt-2 text-sm text-foreground">{item.reflectionSummary || "No summary"}</p>
                <p class="mt-2 text-xs text-muted-foreground">Next: {item.nextAction || "-"}</p>
              </div>
              <div class="rounded-xl border bg-muted/40 p-3">
                <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Output Snapshot</p>
                <p class="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.finalText || "(empty)"}</p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tools</p>
                <p class="mt-1 text-sm text-foreground">{item.toolNames.length > 0 ? item.toolNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Failures</p>
                <p class="mt-1 text-sm text-foreground">{item.failedToolNames.length > 0 ? item.failedToolNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Explicit Skills</p>
                <p class="mt-1 text-sm text-foreground">{item.explicitSkillNames.length > 0 ? item.explicitSkillNames.join(", ") : "-"}</p>
              </div>
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fallback</p>
                <p class="mt-1 text-sm text-foreground">{item.usedFallbackModel ? "Yes" : "No"}</p>
              </div>
            </div>

            {#if item.modelFailureSummaries.length > 0 || item.skillDraftPath}
              <div class="mt-4 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
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
      </div>
    {/if}
  {/if}
</div>
