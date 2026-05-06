<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";

  interface RejectionItem {
    createdAt: string;
    action: "add" | "update";
    channel: string;
    externalUserId: string;
    reason: string;
    content: string;
    layer?: string;
    tags: string[];
  }

  interface Counts {
    total: number;
    add: number;
    update: number;
  }

  let loading = true;
  let error = "";
  let message = "";
  let diagnostics: string[] = [];
  let items: RejectionItem[] = [];
  let counts: Counts = { total: 0, add: 0, update: 0 };
  let searchText = "";

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

  function filteredItems(): RejectionItem[] {
    const query = searchText.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.reason, item.content, item.channel, item.externalUserId, item.layer ?? "", item.tags.join(",")]
        .join("\n")
        .toLowerCase()
        .includes(query)
    );
  }

  async function loadRejections(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/memory-rejections");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load memory rejections");
      items = Array.isArray(data.items) ? data.items : [];
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      counts = {
        total: Number(data.counts?.total ?? 0),
        add: Number(data.counts?.add ?? 0),
        update: Number(data.counts?.update ?? 0)
      };
      message = `Loaded ${items.length} rejected memory write(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadRejections);
</script>

<div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Memory Governance</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Memory Rejections</h1>
      <p class="text-sm leading-6 text-muted-foreground">Review which memory writes were blocked and why.</p>
    </div>
  </header>

  <div class="flex flex-wrap items-center gap-2">
    <Input class="max-w-xs" bind:value={searchText} placeholder="Search reason or content..." />
    <Button variant="outline" onclick={loadRejections}>Refresh</Button>
  </div>

  {#if message}
    <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
  {/if}
  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading memory rejections...</p>
  {:else}
    <div class="flex flex-wrap gap-3 text-sm">
      <Badge variant="outline">Total: {counts.total}</Badge>
      <Badge variant="outline">Add blocked: {counts.add}</Badge>
      <Badge variant="outline">Update blocked: {counts.update}</Badge>
    </div>

    {#if diagnostics.length > 0}
      <Alert variant="default"><AlertDescription class="whitespace-pre-wrap">{diagnostics.join("\n")}</AlertDescription></Alert>
    {/if}

    {#if filteredItems().length === 0}
      <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        No blocked memory writes found.
      </div>
    {:else}
      <div class="space-y-4">
        {#each filteredItems() as item}
          <article class="rounded-2xl border bg-card/60 p-5 text-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">{item.action}</Badge>
                  <span class="text-sm font-semibold text-foreground">{item.channel}:{item.externalUserId}</span>
                  {#if item.layer}
                    <Badge variant="outline">{item.layer}</Badge>
                  {/if}
                </div>
                <p class="mt-2 text-sm text-destructive">{item.reason}</p>
              </div>
              <span class="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
            </div>
            <div class="mt-4 rounded-xl border bg-muted/40 p-3 text-sm text-foreground">
              <p class="whitespace-pre-wrap">{item.content || "(empty)"}</p>
            </div>
            {#if item.tags.length > 0}
              <p class="mt-3 text-xs text-muted-foreground">Tags: {item.tags.join(", ")}</p>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  {/if}
</div>
