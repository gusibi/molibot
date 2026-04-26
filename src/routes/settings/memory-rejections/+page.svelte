<script lang="ts">
  import { onMount } from "svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import Button from "$lib/ui/Button.svelte";
  import PageShell from "$lib/ui/PageShell.svelte";

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

<PageShell widthClass="max-w-6xl" gapClass="space-y-6">
  <header class="wb-hero">
    <div class="wb-hero-copy">
      <p class="wb-eyebrow">Memory Governance</p>
      <h1>Memory Rejections</h1>
      <p class="wb-copy">
        Review which memory writes were blocked and why.
      </p>
    </div>
    <div class="wb-hero-actions">
      <input
        class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm text-[var(--foreground)]"
        bind:value={searchText}
        placeholder="Search reason or content..."
      />
      <Button variant="outline" size="md" on:click={loadRejections}>Refresh</Button>
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
      Loading memory rejections...
    </div>
  {:else}
    <section class="wb-summary-strip text-sm sm:grid-cols-3">
      <div><span class="text-[var(--muted-foreground)]">Total:</span> {counts.total}</div>
      <div><span class="text-[var(--muted-foreground)]">Add blocked:</span> {counts.add}</div>
      <div><span class="text-[var(--muted-foreground)]">Update blocked:</span> {counts.update}</div>
    </section>

    {#if diagnostics.length > 0}
      <Alert className="whitespace-pre-wrap">{diagnostics.join("\n")}</Alert>
    {/if}

    {#if filteredItems().length === 0}
      <div class="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] px-4 py-3 text-sm text-[var(--foreground)]">
        No blocked memory writes found.
      </div>
    {:else}
      <section class="space-y-4">
        {#each filteredItems() as item}
          <article class="rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] p-5 text-sm text-[var(--foreground)]">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full border border-[color-mix(in_oklab,var(--destructive)_36%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_10%,var(--card))] px-2 py-0.5 text-xs text-[var(--destructive)]">
                    {item.action}
                  </span>
                  <span class="text-sm font-semibold">{item.channel}:{item.externalUserId}</span>
                  {#if item.layer}
                    <span class="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--foreground)]">
                      {item.layer}
                    </span>
                  {/if}
                </div>
                <p class="mt-2 text-sm text-[var(--destructive)]">{item.reason}</p>
              </div>
              <div class="text-xs text-[var(--muted-foreground)]">{formatDate(item.createdAt)}</div>
            </div>
            <div class="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--border)_78%,transparent)] bg-[color-mix(in_oklab,var(--muted)_52%,var(--card))] p-3 text-sm text-[var(--foreground)]">
              <p class="whitespace-pre-wrap">{item.content || "(empty)"}</p>
            </div>
            {#if item.tags.length > 0}
              <p class="mt-3 text-xs text-[var(--muted-foreground)]">Tags: {item.tags.join(", ")}</p>
            {/if}
          </article>
        {/each}
      </section>
    {/if}
  {/if}
</PageShell>
