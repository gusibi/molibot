<script lang="ts">
  import { onMount } from "svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import Button from "$lib/ui/Button.svelte";
  import PageShell from "$lib/ui/PageShell.svelte";

  type SkillScope = "global" | "chat" | "bot";

  interface SkillDraftItem {
    filePath: string;
    fileName: string;
    botId: string;
    chatId: string;
    workspaceDir: string;
    name: string;
    description: string;
    draft: boolean;
    source: string;
    mergeCount: number;
    updatedAt: string;
    content: string;
  }

  interface Counts {
    total: number;
    botCount: number;
    chatCount: number;
  }

  let loading = true;
  let error = "";
  let message = "";
  let diagnostics: string[] = [];
  let items: SkillDraftItem[] = [];
  let counts: Counts = { total: 0, botCount: 0, chatCount: 0 };
  let saving = new Set<string>();
  let draftContent: Record<string, string> = {};
  let draftName: Record<string, string> = {};
  let draftScope: Record<string, SkillScope> = {};

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

  function setSaving(filePath: string, active: boolean): void {
    const next = new Set(saving);
    if (active) next.add(filePath);
    else next.delete(filePath);
    saving = next;
  }

  function syncDraftState(rows: SkillDraftItem[]): void {
    draftContent = Object.fromEntries(rows.map((item) => [item.filePath, item.content]));
    draftName = Object.fromEntries(rows.map((item) => [item.filePath, item.name]));
    draftScope = Object.fromEntries(rows.map((item) => [item.filePath, "chat"]));
  }

  async function loadDrafts(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load skill drafts");
      items = Array.isArray(data.items) ? data.items : [];
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      counts = {
        total: Number(data.counts?.total ?? 0),
        botCount: Number(data.counts?.botCount ?? 0),
        chatCount: Number(data.counts?.chatCount ?? 0)
      };
      syncDraftState(items);
      message = `Loaded ${items.length} draft(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function saveDraft(item: SkillDraftItem): Promise<void> {
    const filePath = item.filePath;
    setSaving(filePath, true);
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save",
          filePath,
          content: draftContent[filePath] ?? item.content
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save draft");
      message = "Draft saved.";
      await loadDrafts();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      setSaving(filePath, false);
    }
  }

  async function promoteDraft(item: SkillDraftItem): Promise<void> {
    const filePath = item.filePath;
    setSaving(filePath, true);
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "promote",
          filePath,
          workspaceDir: item.workspaceDir,
          chatId: item.chatId,
          scope: draftScope[filePath] ?? "chat",
          name: draftName[filePath] ?? item.name,
          overwrite: false,
          archiveDraft: true
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to promote draft");
      message = `Draft promoted to ${data.saved?.filePath ?? "skill"}.`;
      await loadDrafts();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      setSaving(filePath, false);
    }
  }

  async function deleteDraft(item: SkillDraftItem): Promise<void> {
    const filePath = item.filePath;
    setSaving(filePath, true);
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skill-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          filePath
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to delete draft");
      message = "Draft deleted.";
      await loadDrafts();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      setSaving(filePath, false);
    }
  }

  onMount(loadDrafts);
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Skill Drafts</h1>
      <p class="text-sm text-slate-400">
        Review reusable workflow drafts before turning them into live skills.
      </p>
    </div>
    <Button variant="outline" size="md" on:click={loadDrafts}>Refresh</Button>
  </div>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading skill drafts...
    </div>
  {:else}
    <section class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 text-sm text-slate-300 sm:grid-cols-3">
      <div><span class="text-slate-400">Total:</span> {counts.total}</div>
      <div><span class="text-slate-400">Bots:</span> {counts.botCount}</div>
      <div><span class="text-slate-400">Chats:</span> {counts.chatCount}</div>
    </section>

    {#if diagnostics.length > 0}
      <Alert className="whitespace-pre-wrap">{diagnostics.join("\n")}</Alert>
    {/if}

    {#if items.length === 0}
      <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
        No skill drafts found yet.
      </div>
    {:else}
      <section class="space-y-4">
        {#each items as item}
          <article class="rounded-2xl border border-white/15 bg-[#2b2b2b] p-5 text-sm text-slate-200">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-base font-semibold">{item.name}</h2>
                  <span class="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300">
                    {draftScope[item.filePath] ?? "chat"}
                  </span>
                  <span class="rounded-full border border-white/15 px-2 py-0.5 text-xs text-slate-300">
                    merged {item.mergeCount ?? 1}
                  </span>
                </div>
                <p class="mt-1 text-xs text-slate-400">{item.botId} / {item.chatId} · {formatDate(item.updatedAt)}</p>
                <p class="mt-2 text-sm text-slate-400">{item.description || "No description"}</p>
              </div>
              <div class="text-right text-xs text-slate-400">
                <div>{item.source || "manual review"}</div>
                <div>{item.fileName}</div>
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
              <label class="space-y-2">
                <span class="text-xs uppercase tracking-wide text-slate-400">Skill Name</span>
                <input
                  class="w-full rounded-xl border border-white/15 bg-black/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                  bind:value={draftName[item.filePath]}
                />
              </label>
              <label class="space-y-2">
                <span class="text-xs uppercase tracking-wide text-slate-400">Promote Scope</span>
                <select
                  class="w-full rounded-xl border border-white/15 bg-black/10 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                  bind:value={draftScope[item.filePath]}
                >
                  <option value="chat">Chat</option>
                  <option value="bot">Bot</option>
                  <option value="global">Global</option>
                </select>
              </label>
            </div>

            <label class="mt-4 block space-y-2">
              <span class="text-xs uppercase tracking-wide text-slate-400">Draft Content</span>
              <textarea
                class="min-h-[320px] w-full rounded-2xl border border-white/15 bg-black/10 px-4 py-3 font-mono text-xs text-slate-100 outline-none focus:border-sky-400"
                bind:value={draftContent[item.filePath]}
              />
            </label>

            <div class="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={saving.has(item.filePath)} on:click={() => saveDraft(item)}>
                Save Draft
              </Button>
              <Button size="sm" disabled={saving.has(item.filePath)} on:click={() => promoteDraft(item)}>
                Promote To Skill
              </Button>
              <Button variant="destructive" size="sm" disabled={saving.has(item.filePath)} on:click={() => deleteDraft(item)}>
                Delete Draft
              </Button>
            </div>
          </article>
        {/each}
      </section>
    {/if}
  {/if}
</PageShell>
