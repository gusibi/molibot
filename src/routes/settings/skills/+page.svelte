<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  type SkillScope = "global" | "chat" | "bot";

  interface SkillItem {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    scope: SkillScope;
    enabled: boolean;
    mcpServers: string[];
    botId?: string;
    chatId?: string;
  }

  let loading = true;
  let error = "";
  let message = "";
  let dataRoot = "";
  let globalSkillsDir = "";
  let diagnostics: string[] = [];
  let items: SkillItem[] = [];
  let count = { global: 0, chat: 0, bot: 0 };
  let saving = new Set<string>();

  function byScope(scope: SkillScope): SkillItem[] {
    return items
      .filter((item) => item.scope === scope)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadSkills(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skills");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load skills");
      dataRoot = String(data.dataRoot ?? "");
      globalSkillsDir = String(data.globalSkillsDir ?? "");
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      items = Array.isArray(data.items) ? data.items : [];
      count = {
        global: Number(data.count?.global ?? 0),
        chat: Number(data.count?.chat ?? 0),
        bot: Number(data.count?.bot ?? 0),
      };
      message = `Loaded ${items.length} skill(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function setSkillEnabled(filePath: string, enabled: boolean): Promise<void> {
    error = "";
    message = "";
    const prev = items;
    items = items.map((item) => item.filePath === filePath ? { ...item, enabled } : item);
    saving = new Set([...saving, filePath]);
    try {
      const disabledSkillPaths = items.filter((item) => !item.enabled).map((item) => item.filePath);
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledSkillPaths })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save skill status");
      message = "Skill status updated.";
    } catch (e) {
      items = prev;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      const next = new Set(saving);
      next.delete(filePath);
      saving = next;
    }
  }

  onMount(loadSkills);
</script>

<PageShell widthClass="max-w-5xl" gapClass="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Skills</h1>
      <p class="text-sm text-slate-400">
        Inspect installed skills by scope and path.
      </p>
    </div>
    <Button variant="outline" size="md" on:click={loadSkills}>
      Refresh
    </Button>
  </div>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

        {#if loading}
          <div
            class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300"
          >
            Loading skills...
          </div>
        {:else}
          <section
            class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 text-sm text-slate-300 sm:grid-cols-2"
          >
            <div>
              <span class="text-slate-400">Data root:</span>
              {dataRoot || "(unknown)"}
            </div>
            <div>
              <span class="text-slate-400">Global skills dir:</span>
              {globalSkillsDir || "(unknown)"}
            </div>
            <div>
              <span class="text-slate-400">Global skills:</span>
              {count.global}
            </div>
            <div>
              <span class="text-slate-400">Chat skills:</span>
              {count.chat}
            </div>
            <div>
              <span class="text-slate-400">Bot skills:</span>
              {count.bot}
            </div>
            <div><span class="text-slate-400">Total:</span> {items.length}</div>
          </section>

          <section class="space-y-3">
            <h2 class="text-lg font-semibold">Global Skills</h2>
            {#if byScope("global").length === 0}
              <div
                class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300"
              >
                No global skills found.
              </div>
            {:else}
              {#each byScope("global") as item}
                <article
                  class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
                >
                  <div class="flex items-start justify-between gap-3">
                    <p class="text-sm font-semibold">{item.name}</p>
                    <label class="inline-flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        disabled={saving.has(item.filePath)}
                        on:change={(event) => setSkillEnabled(item.filePath, (event.target as HTMLInputElement).checked)}
                      />
                      <span>{item.enabled ? "Enabled" : "Disabled"}</span>
                    </label>
                  </div>
                  <p class="mt-1 text-sm text-slate-400">{item.description}</p>
                  <p class="mt-2 text-xs text-slate-400">
                    Path: {item.filePath}
                  </p>
                  {#if item.mcpServers?.length > 0}
                    <p class="mt-1 text-xs text-emerald-300">
                      MCP: {item.mcpServers.join(", ")}
                    </p>
                  {/if}
                </article>
              {/each}
            {/if}
          </section>

          <section class="space-y-3">
            <h2 class="text-lg font-semibold">Chat Skills</h2>
            {#if byScope("chat").length === 0}
              <div
                class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300"
              >
                No chat-level skills found.
              </div>
            {:else}
              {#each byScope("chat") as item}
                <article
                  class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
                >
                  <div class="flex items-start justify-between gap-3">
                    <p class="text-sm font-semibold">{item.name}</p>
                    <label class="inline-flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        disabled={saving.has(item.filePath)}
                        on:change={(event) => setSkillEnabled(item.filePath, (event.target as HTMLInputElement).checked)}
                      />
                      <span>{item.enabled ? "Enabled" : "Disabled"}</span>
                    </label>
                  </div>
                  <p class="mt-1 text-sm text-slate-400">{item.description}</p>
                  <p class="mt-2 text-xs text-slate-400">
                    Bot: {item.botId || "-"} | Chat: {item.chatId || "-"}
                  </p>
                  <p class="mt-1 text-xs text-slate-400">
                    Path: {item.filePath}
                  </p>
                  {#if item.mcpServers?.length > 0}
                    <p class="mt-1 text-xs text-emerald-300">
                      MCP: {item.mcpServers.join(", ")}
                    </p>
                  {/if}
                </article>
              {/each}
            {/if}
          </section>

          <section class="space-y-3">
            <h2 class="text-lg font-semibold">Bot Skills</h2>
            {#if byScope("bot").length === 0}
              <div
                class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300"
              >
                No bot-level skills found.
              </div>
            {:else}
              {#each byScope("bot") as item}
                <article
                  class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
                >
                  <div class="flex items-start justify-between gap-3">
                    <p class="text-sm font-semibold">{item.name}</p>
                    <label class="inline-flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        disabled={saving.has(item.filePath)}
                        on:change={(event) => setSkillEnabled(item.filePath, (event.target as HTMLInputElement).checked)}
                      />
                      <span>{item.enabled ? "Enabled" : "Disabled"}</span>
                    </label>
                  </div>
                  <p class="mt-1 text-sm text-slate-400">{item.description}</p>
                  <p class="mt-2 text-xs text-slate-400">
                    Bot: {item.botId || "-"}
                  </p>
                  <p class="mt-1 text-xs text-slate-400">
                    Path: {item.filePath}
                  </p>
                  {#if item.mcpServers?.length > 0}
                    <p class="mt-1 text-xs text-emerald-300">
                      MCP: {item.mcpServers.join(", ")}
                    </p>
                  {/if}
                </article>
              {/each}
            {/if}
          </section>

          {#if diagnostics.length > 0}
            <section
              class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
            >
              <h2 class="text-sm font-semibold text-amber-300">Diagnostics</h2>
              {#each diagnostics as row}
                <p class="text-xs text-amber-200">{row}</p>
              {/each}
            </section>
          {/if}
        {/if}
</PageShell>
