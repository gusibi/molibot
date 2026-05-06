<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";

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
    if (!data.ok) throw new Error(data.error || "Failed to load memory settings");
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

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Memory Operations</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Memory Management</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Search, flush, edit and delete runtime memories. Settings page defaults to all scopes so you can inspect everything in one place. Conflicts are marked for review.
      </p>
    </div>
  </header>

  <div class="flex flex-wrap gap-2 text-xs">
    <Badge variant="outline">plugin {memoryEnabled ? "enabled" : "disabled"}</Badge>
    <Badge variant="outline">active backend {activeBackend}</Badge>
    <a class="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-3 py-1.5 text-primary hover:bg-primary/15" href="/settings/plugins">
      switch in plugin settings
    </a>
  </div>

  <div class="grid gap-3 sm:grid-cols-[120px_220px_1fr_auto]">
    <Input bind:value={channel} placeholder="channel" />
    <Input bind:value={userId} placeholder="userId" />
    <Input bind:value={searchText} placeholder="Search memory content..." />
    <div class="flex items-center gap-2 rounded-lg border px-3 py-2">
      <Checkbox id="mem-all-scopes" bind:checked={allScopes} />
      <Label for="mem-all-scopes" class="text-sm">All scopes</Label>
    </div>
  </div>

  <div class="flex flex-wrap gap-2">
    <Button variant="outline" onclick={listMemory}>Search</Button>
    <Button variant="outline" onclick={syncMemory} disabled={syncing}>
      {syncing ? "Syncing..." : "Sync Files"}
    </Button>
    <Button variant="secondary" onclick={flushMemory} disabled={flushing}>
      {flushing ? "Flushing..." : "Flush"}
    </Button>
    <Button variant="outline" onclick={compactMemory} disabled={compacting}>
      {compacting ? "Deduping..." : "Deduplicate"}
    </Button>
  </div>

  {#if message}
    <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
  {/if}
  {#if syncInfo}
    <Alert variant="default"><AlertDescription>{syncInfo}</AlertDescription></Alert>
  {/if}
  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Loading memory...</div>
  {:else if items.length === 0}
    <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      No memory found. Toggle scope filters or run Sync Files if you expect imported memory.
    </div>
  {:else}
    <div class="space-y-3">
      {#each items as item (item.id)}
        <article class="space-y-3 rounded-xl border bg-card/60 p-4">
          <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline" class="text-[10px]">source {item.channel}:{item.externalUserId}</Badge>
              <Badge variant="outline" class="text-[10px]">{item.layer}</Badge>
              {#if item.sourceSessionId}
                <Badge variant="outline" class="text-[10px]">session {item.sourceSessionId}</Badge>
              {/if}
              {#if item.hasConflict}
                <Badge variant="secondary" class="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400">conflict</Badge>
              {/if}
              {#if item.expiresAt}
                <Badge variant="default" class="text-[10px]">expires {item.expiresAt.slice(0, 10)}</Badge>
              {/if}
            </div>
            <span>updated {item.updatedAt.replace("T", " ").slice(0, 19)}</span>
          </div>

          <Textarea class="min-h-20" bind:value={item.content} />

          <div class="grid gap-2 sm:grid-cols-[1fr_220px_auto_auto]">
            <Input
              value={item.tags.join(",")}
              onchange={(e) => {
                const value = (e.currentTarget as HTMLInputElement).value;
                item.tags = value.split(",").map((v) => v.trim()).filter(Boolean);
              }}
              placeholder="tag1,tag2"
            />
            <Input bind:value={item.expiresAt} placeholder="expiresAt (ISO8601)" />
            <Button variant="outline" onclick={() => saveItem(item)}>Save</Button>
            <Button variant="destructive" onclick={() => removeItem(item)}>Delete</Button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>
