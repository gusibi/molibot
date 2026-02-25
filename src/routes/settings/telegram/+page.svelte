<script lang="ts">
  import { onMount } from "svelte";

  interface TelegramBotForm {
    id: string;
    name: string;
    token: string;
    allowedChatIds: string;
  }

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let bots: TelegramBotForm[] = [];

  function createBotId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `bot-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `bot-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createEmptyBot(): TelegramBotForm {
    return {
      id: createBotId(),
      name: "",
      token: "",
      allowedChatIds: ""
    };
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");

      const fromList = Array.isArray(data.settings.telegramBots) ? data.settings.telegramBots : [];
      if (fromList.length > 0) {
        bots = fromList.map((bot: { id?: string; name?: string; token?: string; allowedChatIds?: string[] }) => ({
          id: bot.id ?? createBotId(),
          name: bot.name ?? "",
          token: bot.token ?? "",
          allowedChatIds: (bot.allowedChatIds ?? []).join(",")
        }));
      } else {
        const token = data.settings.telegramBotToken ?? "";
        bots = token
          ? [{
              id: "default",
              name: "Default Bot",
              token,
              allowedChatIds: (data.settings.telegramAllowedChatIds ?? []).join(",")
            }]
          : [createEmptyBot()];
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramBots: bots
            .map((bot) => ({
              id: bot.id.trim(),
              name: bot.name.trim(),
              token: bot.token.trim(),
              allowedChatIds: bot.allowedChatIds
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
            }))
            .filter((bot) => bot.id && bot.token)
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save Telegram settings");
      message = "Telegram settings saved and reloaded.";
      await loadSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function addBot(): void {
    bots = [...bots, createEmptyBot()];
  }

  function removeBot(index: number): void {
    bots = bots.filter((_, idx) => idx !== index);
    if (bots.length === 0) {
      bots = [createEmptyBot()];
    }
  }

  onMount(loadSettings);
</script>

<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:block">
      <nav class="space-y-1 text-sm">
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/">Chat</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings">Settings</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/ai">AI</a>
        <a class="block rounded-lg bg-white/15 px-3 py-2 font-medium text-white" href="/settings/telegram">Telegram</a>
      </nav>
    </aside>

    <section class="min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
      <div class="mx-auto max-w-3xl space-y-4">
        <h1 class="text-2xl font-semibold">Telegram Settings</h1>
        <p class="text-sm text-slate-400">Configure multiple bot tokens and allowed chat IDs.</p>

        {#if loading}
          <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">Loading Telegram settings...</div>
        {:else}
          <form class="space-y-4" on:submit|preventDefault={save}>
            {#each bots as bot, idx (bot.id)}
              <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
                <div class="flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-slate-200">Bot #{idx + 1}</h2>
                  <button
                    class="cursor-pointer rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                    type="button"
                    on:click={() => removeBot(idx)}
                  >
                    Remove
                  </button>
                </div>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Bot ID</span>
                  <input
                    class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    bind:value={bot.id}
                    placeholder="marketing-bot"
                  />
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Bot Name</span>
                  <input
                    class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    bind:value={bot.name}
                    placeholder="Marketing Bot"
                  />
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Bot token</span>
                  <input
                    class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    bind:value={bot.token}
                    type="password"
                    placeholder="123456:ABCDEF..."
                  />
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Allowed chat IDs (comma-separated)</span>
                  <input
                    class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                    bind:value={bot.allowedChatIds}
                    placeholder="123456789,-1001234567890"
                  />
                </label>
              </section>
            {/each}

            <button
              class="cursor-pointer rounded-lg border border-white/20 bg-[#2b2b2b] px-4 py-2 text-sm font-semibold text-slate-100 transition-colors duration-200 hover:bg-[#343434]"
              type="button"
              on:click={addBot}
            >
              Add Bot
            </button>

            <button
              class="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
              type="submit"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Telegram Settings"}
            </button>

            {#if message}
              <p class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{message}</p>
            {/if}
            {#if error}
              <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
            {/if}
          </form>
        {/if}
      </div>
    </section>
  </div>
</main>
