<script lang="ts">
  import { onMount } from "svelte";

  interface MemoryItem {
    id: string;
    channel: string;
    externalUserId: string;
    content: string;
    tags: string[];
    layer: "long_term" | "daily";
    hasConflict?: boolean;
    expiresAt?: string;
    updatedAt: string;
  }

  let loading = true;
  let flushing = false;
  let searchText = "";
  let message = "";
  let error = "";
  let syncInfo = "";
  let items: MemoryItem[] = [];
  let channel = "";
  let userId = "";

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
          query: searchText.trim(),
          limit: 200
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load memory");
      items = Array.isArray(data.items) ? data.items : [];
      syncInfo = `sync scanned ${Number(data.sync?.scannedFiles ?? 0)} file(s), imported ${Number(data.sync?.importedCount ?? 0)}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
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
        body: JSON.stringify({ action: "flush", channel, userId })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Flush failed");
      message = `Flush done: scanned ${data.result?.scannedMessages ?? 0}, added ${data.result?.addedCount ?? 0}.`;
      syncInfo = `sync scanned ${Number(data.sync?.scannedFiles ?? 0)} file(s), imported ${Number(data.sync?.importedCount ?? 0)}`;
      await listMemory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      flushing = false;
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
          id: item.id
        })
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
          expiresAt: item.expiresAt || null
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Update failed");
      if (data.item) {
        items = items.map((row) => row.id === item.id ? data.item : row);
      }
      message = "Memory updated.";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(listMemory);
</script>

<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:block">
      <nav class="space-y-1 text-sm">
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/">Chat</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings">Settings</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/ai">AI</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/telegram">Telegram</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/tasks">Tasks</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/skills">Skills</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/plugins">Plugins</a>
        <a class="block rounded-lg bg-white/15 px-3 py-2 font-medium text-white" href="/settings/memory">Memory</a>
      </nav>
    </aside>

    <section class="min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
      <div class="mx-auto max-w-5xl space-y-4">
        <h1 class="text-2xl font-semibold">Memory Management</h1>
        <p class="text-sm text-slate-400">Search, flush, edit and delete runtime memories. Conflicts are marked for review.</p>

        <div class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 sm:grid-cols-[120px_220px_1fr_auto_auto]">
          <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm" bind:value={channel} placeholder="channel" />
          <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm" bind:value={userId} placeholder="userId" />
          <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm" bind:value={searchText} placeholder="Search memory content..." />
          <button class="rounded-lg border border-white/20 bg-[#1f1f1f] px-3 py-2 text-sm hover:bg-[#343434]" on:click={listMemory}>Search</button>
          <button class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60" on:click={flushMemory} disabled={flushing}>
            {flushing ? "Flushing..." : "Flush"}
          </button>
        </div>

        {#if message}
          <p class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{message}</p>
        {/if}
        {#if syncInfo}
          <p class="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">{syncInfo}</p>
        {/if}
        {#if error}
          <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
        {/if}

        {#if loading}
          <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">Loading memory...</div>
        {:else if items.length === 0}
          <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">No memory found.</div>
        {:else}
          <div class="space-y-3">
            {#each items as item (item.id)}
              <article class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
                <div class="flex items-center justify-between gap-3 text-xs text-slate-400">
                  <div class="flex items-center gap-2">
                    <span class="rounded border border-white/20 px-2 py-0.5">{item.channel}:{item.externalUserId}</span>
                    <span class="rounded border border-white/20 px-2 py-0.5">{item.layer}</span>
                    {#if item.hasConflict}
                      <span class="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-amber-300">conflict</span>
                    {/if}
                    {#if item.expiresAt}
                      <span class="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-sky-300">expires {item.expiresAt.slice(0, 10)}</span>
                    {/if}
                  </div>
                  <span>updated {item.updatedAt.replace("T", " ").slice(0, 19)}</span>
                </div>

                <textarea class="min-h-20 w-full rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm" bind:value={item.content}></textarea>

                <div class="grid gap-2 sm:grid-cols-[1fr_220px_auto_auto]">
                  <input
                    class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm"
                    value={item.tags.join(",")}
                    on:change={(e) => {
                      const value = (e.currentTarget as HTMLInputElement).value;
                      item.tags = value.split(",").map((v) => v.trim()).filter(Boolean);
                    }}
                    placeholder="tag1,tag2"
                  />
                  <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm" bind:value={item.expiresAt} placeholder="expiresAt (ISO8601)" />
                  <button class="rounded-lg border border-white/20 bg-[#1f1f1f] px-3 py-2 text-sm hover:bg-[#343434]" on:click={() => saveItem(item)}>Save</button>
                  <button class="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/20" on:click={() => removeItem(item)}>Delete</button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
</main>
