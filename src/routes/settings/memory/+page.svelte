<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  interface MemoryItem {
    id: string;
    channel: string;
    externalUserId: string;
    content: string;
    tags: string[];
    layer: "long_term" | "daily";
    hasConflict?: boolean;
    expiresAt?: string;
    sourceSessionId?: string;
    updatedAt: string;
  }

  let loading = true;
  let flushing = false;
  let compacting = false;
  let syncing = false;
  let searchText = "";
  let allScopes = true;
  let message = "";
  let error = "";
  let syncInfo = "";
  let items: MemoryItem[] = [];
  let channel = "";
  let userId = "";
  let memoryEnabled = false;
  let activeBackend = "json-file";

  async function loadRuntimeMemorySettings(): Promise<void> {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (!data.ok)
      throw new Error(data.error || "Failed to load memory settings");
    memoryEnabled = Boolean(data.settings?.plugins?.memory?.enabled);
    activeBackend = String(
      (data.settings?.plugins?.memory as any)?.backend ?? (data.settings?.plugins?.memory as any)?.core ?? "json-file",
    );
  }

  async function listMemory(): Promise<void> {
    loading = true;
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: searchText.trim() ? "search" : "list",
          channel,
          userId,
          allScopes,
          query: searchText.trim(),
          limit: 200,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load memory");
      items = Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function syncMemory(): Promise<void> {
    syncing = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Sync failed");
      syncInfo = `sync scanned ${Number(data.sync?.scannedFiles ?? 0)} file(s), imported ${Number(data.sync?.importedCount ?? 0)}`;
      message = "External memory sync completed.";
      await listMemory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      syncing = false;
    }
  }

  async function flushMemory(): Promise<void> {
    flushing = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flush", channel, userId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Flush failed");
      message = `Flush done: scanned ${data.result?.scannedMessages ?? 0}, added ${data.result?.addedCount ?? 0}.`;
      await listMemory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      flushing = false;
    }
  }

  async function compactMemory(): Promise<void> {
    compacting = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compact", channel, userId, allScopes }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Compact failed");
      message = `Dedup completed: scanned ${data.result?.scannedCount ?? 0}, removed ${data.result?.removedCount ?? 0}, affected scopes ${data.result?.scopesAffected ?? 0}.`;
      await listMemory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      compacting = false;
    }
  }

  async function removeItem(item: MemoryItem): Promise<void> {
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          channel: item.channel,
          userId: item.externalUserId,
          id: item.id,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Delete failed");
      items = items.filter((row) => row.id !== item.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveItem(item: MemoryItem): Promise<void> {
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          channel: item.channel,
          userId: item.externalUserId,
          id: item.id,
          content: item.content,
          tags: item.tags,
          expiresAt: item.expiresAt || null,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Update failed");
      if (data.item) {
        items = items.map((row) => (row.id === item.id ? data.item : row));
      }
      message = "Memory updated.";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(async () => {
    try {
      await loadRuntimeMemorySettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await listMemory();
  });
</script>

<PageShell widthClass="max-w-5xl" gapClass="space-y-6">
        <header class="wb-hero">
          <div class="wb-hero-copy">
            <p class="wb-eyebrow">Memory Operations</p>
            <h1>Memory Management</h1>
            <p class="wb-copy">
              Search, flush, edit and delete runtime memories. Settings page defaults
              to all scopes so you can inspect everything in one place. Conflicts are
              marked for review.
            </p>
          </div>
        </header>

        <div class="flex flex-wrap gap-2 text-xs">
          <span
            class="rounded border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] px-3 py-1.5 text-[var(--foreground)]"
          >
            plugin {memoryEnabled ? "enabled" : "disabled"}
          </span>
          <span
            class="rounded border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] px-3 py-1.5 text-[var(--foreground)]"
          >
            active backend {activeBackend}
          </span>
          <a
            class="rounded border border-[color-mix(in_oklab,var(--primary)_30%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] px-3 py-1.5 text-[color-mix(in_oklab,var(--primary)_74%,var(--foreground))] hover:bg-[color-mix(in_oklab,var(--primary)_16%,var(--card))]"
            href="/settings/plugins"
          >
            switch in plugin settings
          </a>
        </div>

        <div
          class="wb-toolbar grid gap-3 sm:grid-cols-[120px_220px_1fr_auto_auto_auto_auto]"
        >
          <input
            class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm"
            bind:value={channel}
            placeholder="channel"
          />
          <input
            class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm"
            bind:value={userId}
            placeholder="userId"
          />
          <input
            class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm"
            bind:value={searchText}
            placeholder="Search memory content..."
          />
          <label class="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm text-[var(--foreground)]">
            <input bind:checked={allScopes} type="checkbox" />
            All scopes
          </label>
          <Button variant="outline" size="md" on:click={listMemory}>Search</Button>
          <Button
            variant="outline"
            size="md"
            className="disabled:opacity-60"
            on:click={syncMemory}
            disabled={syncing}
          >
            {syncing ? "Syncing..." : "Sync Files"}
          </Button>
          <Button
            variant="secondary"
            size="md"
            className="disabled:opacity-60"
            on:click={flushMemory}
            disabled={flushing}
          >
            {flushing ? "Flushing..." : "Flush"}
          </Button>
          <Button
            variant="outline"
            size="md"
            className="disabled:opacity-60"
            on:click={compactMemory}
            disabled={compacting}
          >
            {compacting ? "Deduping..." : "Deduplicate"}
          </Button>
        </div>

        {#if message}
          <Alert variant="success">{message}</Alert>
        {/if}
        {#if syncInfo}
          <Alert>{syncInfo}</Alert>
        {/if}
        {#if error}
          <Alert variant="destructive">{error}</Alert>
        {/if}

        {#if loading}
          <div
            class="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] px-4 py-3 text-sm text-[var(--foreground)]"
          >
            Loading memory...
          </div>
        {:else if items.length === 0}
          <div
            class="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] px-4 py-3 text-sm text-[var(--foreground)]"
          >
            No memory found. Toggle scope filters or run Sync Files if you expect imported memory.
          </div>
        {:else}
          <div class="space-y-3">
            {#each items as item (item.id)}
              <article
                class="space-y-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_94%,transparent)] p-4"
              >
                <div
                  class="flex items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]"
                >
                  <div class="flex items-center gap-2">
                    <span class="rounded border border-[color-mix(in_oklab,var(--border)_82%,transparent)] px-2 py-0.5">
                      source {item.channel}:{item.externalUserId}
                    </span>
                    <span class="rounded border border-[color-mix(in_oklab,var(--border)_82%,transparent)] px-2 py-0.5"
                      >{item.layer}</span
                    >
                    {#if item.sourceSessionId}
                      <span class="rounded border border-[color-mix(in_oklab,var(--border)_82%,transparent)] px-2 py-0.5">
                        session {item.sourceSessionId}
                      </span>
                    {/if}
                    {#if item.hasConflict}
                      <span
                        class="rounded border border-amber-500/50 bg-[color-mix(in_oklab,hsl(38_84%_54%)_10%,var(--card))] px-2 py-0.5 text-[color-mix(in_oklab,hsl(38_84%_44%)_78%,var(--foreground))]"
                        >conflict</span
                      >
                    {/if}
                    {#if item.expiresAt}
                      <span
                        class="rounded border border-[color-mix(in_oklab,var(--primary)_34%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] px-2 py-0.5 text-[color-mix(in_oklab,var(--primary)_74%,var(--foreground))]"
                        >expires {item.expiresAt.slice(0, 10)}</span
                      >
                    {/if}
                  </div>
                  <span
                    >updated {item.updatedAt
                      .replace("T", " ")
                      .slice(0, 19)}</span
                  >
                </div>

                <textarea
                  class="min-h-20 w-full rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm"
                  bind:value={item.content}
                ></textarea>

                <div class="grid gap-2 sm:grid-cols-[1fr_220px_auto_auto]">
                  <input
                    class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm"
                    value={item.tags.join(",")}
                    on:change={(e) => {
                      const value = (e.currentTarget as HTMLInputElement).value;
                      item.tags = value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean);
                    }}
                    placeholder="tag1,tag2"
                  />
                  <input
                    class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm"
                    bind:value={item.expiresAt}
                    placeholder="expiresAt (ISO8601)"
                  />
                  <Button variant="outline" size="md" on:click={() => saveItem(item)}>Save</Button>
                  <Button variant="destructive" size="md" on:click={() => removeItem(item)}>Delete</Button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
</PageShell>
