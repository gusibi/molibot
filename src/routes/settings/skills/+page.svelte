<script lang="ts">
  import { onMount } from "svelte";

  type SkillScope = "global" | "chat" | "workspace-legacy";

  interface SkillItem {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    scope: SkillScope;
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
  let count = { global: 0, chat: 0, workspaceLegacy: 0 };

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
        workspaceLegacy: Number(data.count?.workspaceLegacy ?? 0),
      };
      message = `Loaded ${items.length} skill(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadSkills);
</script>

<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:block">
      <nav class="space-y-1 text-sm">
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/">Chat</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings">Settings</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/ai">AI</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/telegram">Telegram</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/feishu">Feishu</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/tasks">Tasks</a
        >
        <a
          class="block rounded-lg bg-white/15 px-3 py-2 font-medium text-white"
          href="/settings/skills">Skills</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/plugins">Plugins</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/memory">Memory</a
        >
      </nav>
    </aside>

    <section class="min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
      <div class="mx-auto max-w-5xl space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-2xl font-semibold">Skills</h1>
            <p class="text-sm text-slate-400">
              Inspect installed skills by scope and path.
            </p>
          </div>
          <button
            class="cursor-pointer rounded-lg border border-white/20 bg-[#2b2b2b] px-3 py-2 text-sm hover:bg-[#343434]"
            on:click={loadSkills}
          >
            Refresh
          </button>
        </div>

        {#if message}
          <p
            class="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-300"
          >
            {message}
          </p>
        {/if}
        {#if error}
          <p
            class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
          >
            {error}
          </p>
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
              <span class="text-slate-400">Workspace legacy skills:</span>
              {count.workspaceLegacy}
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
                  <p class="text-sm font-semibold">{item.name}</p>
                  <p class="mt-1 text-sm text-slate-400">{item.description}</p>
                  <p class="mt-2 text-xs text-slate-400">
                    Path: {item.filePath}
                  </p>
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
                  <p class="text-sm font-semibold">{item.name}</p>
                  <p class="mt-1 text-sm text-slate-400">{item.description}</p>
                  <p class="mt-2 text-xs text-slate-400">
                    Bot: {item.botId || "-"} | Chat: {item.chatId || "-"}
                  </p>
                  <p class="mt-1 text-xs text-slate-400">
                    Path: {item.filePath}
                  </p>
                </article>
              {/each}
            {/if}
          </section>

          <section class="space-y-3">
            <h2 class="text-lg font-semibold">Workspace Legacy Skills</h2>
            {#if byScope("workspace-legacy").length === 0}
              <div
                class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300"
              >
                No workspace-legacy skills found.
              </div>
            {:else}
              {#each byScope("workspace-legacy") as item}
                <article
                  class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
                >
                  <p class="text-sm font-semibold">{item.name}</p>
                  <p class="mt-1 text-sm text-slate-400">{item.description}</p>
                  <p class="mt-2 text-xs text-slate-400">
                    Bot: {item.botId || "-"}
                  </p>
                  <p class="mt-1 text-xs text-slate-400">
                    Path: {item.filePath}
                  </p>
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
      </div>
    </section>
  </div>
</main>
