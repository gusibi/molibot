<script lang="ts">
  import { onMount } from "svelte";

  interface TelegramForm {
    telegramBotToken: string;
    telegramAllowedChatIds: string;
  }

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let form: TelegramForm = {
    telegramBotToken: "",
    telegramAllowedChatIds: ""
  };

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");

      form = {
        telegramBotToken: data.settings.telegramBotToken ?? "",
        telegramAllowedChatIds: (data.settings.telegramAllowedChatIds ?? []).join(",")
      };
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
        body: JSON.stringify(form)
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
        <p class="text-sm text-slate-400">Configure bot token and allowed chat IDs.</p>

        {#if loading}
          <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">Loading Telegram settings...</div>
        {:else}
          <form class="space-y-4" on:submit|preventDefault={save}>
            <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Bot token</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={form.telegramBotToken}
                  type="password"
                  placeholder="123456:ABCDEF..."
                />
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Allowed chat IDs (comma-separated)</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={form.telegramAllowedChatIds}
                  placeholder="123456789,-1001234567890"
                />
              </label>
            </section>

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
