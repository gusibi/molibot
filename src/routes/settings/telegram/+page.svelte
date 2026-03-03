<script lang="ts">
  import { onMount } from "svelte";

  interface AgentItem {
    id: string;
    name: string;
    enabled: boolean;
  }

  interface TelegramBotForm {
    id: string;
    name: string;
    enabled: boolean;
    agentId: string;
    token: string;
    allowedChatIds: string;
    profileFiles: Record<string, string>;
    isNew: boolean;
  }

  const botFileNames = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let bots: TelegramBotForm[] = [];
  let agents: AgentItem[] = [];
  let selectedBotId = "";

  function createBotId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `bot-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `bot-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyBotFiles(): Record<string, string> {
    return Object.fromEntries(botFileNames.map((fileName) => [fileName, ""]));
  }

  function createEmptyBot(): TelegramBotForm {
    return {
      id: createBotId(),
      name: "",
      enabled: false,
      agentId: "",
      token: "",
      allowedChatIds: "",
      profileFiles: emptyBotFiles(),
      isNew: true
    };
  }

  async function loadBotFiles(botId: string): Promise<Record<string, string>> {
    if (!botId) return emptyBotFiles();
    const res = await fetch(
      `/api/settings/profile-files?scope=bot&channel=telegram&botId=${encodeURIComponent(botId)}`
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `Failed to load bot files for ${botId}`);
    return Object.assign(emptyBotFiles(), data.files ?? {});
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");

      agents = Array.isArray(data.settings?.agents) ? data.settings.agents : [];
      const fromList = Array.isArray(data.settings?.channels?.telegram?.instances)
        ? data.settings.channels.telegram.instances
        : [];

      const mapped = fromList.length > 0
        ? fromList.map((bot: {
            id?: string;
            name?: string;
            enabled?: boolean;
            agentId?: string;
            credentials?: { token?: string };
            allowedChatIds?: string[];
          }) => ({
            id: bot.id ?? createBotId(),
            name: bot.name ?? "",
            enabled: bot.enabled ?? true,
            agentId: bot.agentId ?? "",
            token: bot.credentials?.token ?? "",
            allowedChatIds: (bot.allowedChatIds ?? []).join(","),
            profileFiles: emptyBotFiles(),
            isNew: false
          }))
        : (() => {
            const token = data.settings.telegramBotToken ?? "";
            return token
              ? [{
                  id: "default",
                  name: "Default Bot",
                  enabled: true,
                  agentId: "",
                  token,
                  allowedChatIds: (data.settings.telegramAllowedChatIds ?? []).join(","),
                  profileFiles: emptyBotFiles(),
                  isNew: false
                }]
              : [createEmptyBot()];
          })();

      bots = await Promise.all(
        mapped.map(async (bot) => ({
          ...bot,
          profileFiles: await loadBotFiles(bot.id)
        }))
      );
      selectedBotId = bots[0]?.id ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function selectBot(botId: string): void {
    selectedBotId = botId;
  }

  function addBot(): void {
    const next = createEmptyBot();
    bots = [...bots, next];
    selectedBotId = next.id;
  }

  function removeBot(botId: string): void {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(`Delete bot "${botId}"? This cannot be undone.`);
    if (!confirmed) return;

    bots = bots.filter((bot) => bot.id !== botId);
    if (bots.length === 0) {
      const next = createEmptyBot();
      bots = [next];
    }
    selectedBotId = bots[0]?.id ?? "";
  }

  async function save(): Promise<void> {
    saving = true;
    error = "";
    message = "";
    try {
      const normalizedBots = bots
        .map((bot) => ({
          id: bot.id.trim(),
          name: bot.name.trim(),
          enabled: Boolean(bot.enabled),
          agentId: bot.agentId.trim(),
          credentials: {
            token: bot.token.trim()
          },
          allowedChatIds: bot.allowedChatIds
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          profileFiles: bot.profileFiles
        }))
        .filter((bot) => bot.id);

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: {
            telegram: {
              instances: normalizedBots.map(({ profileFiles, ...bot }) => bot)
            }
          }
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save Telegram settings");

      for (const bot of normalizedBots) {
        const fileRes = await fetch("/api/settings/profile-files", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "bot",
            channel: "telegram",
            botId: bot.id,
            files: bot.profileFiles
          })
        });
        const fileData = await fileRes.json();
        if (!fileData.ok) throw new Error(fileData.error || `Failed to save bot files for ${bot.id}`);
      }

      message = "Telegram settings, agent links, and bot Markdown files saved.";
      await loadSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  $: selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? bots[0];

  onMount(loadSettings);
</script>

<div class="mx-auto max-w-7xl space-y-6 px-6 py-8 sm:px-10 sm:py-12">
  <div>
    <h1 class="text-2xl font-semibold">Telegram Settings</h1>
    <p class="text-sm text-slate-400">
      Configure Telegram bots, link them to agents, and edit bot-level Markdown overrides.
    </p>
  </div>

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading Telegram settings...
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-200">Bots</h2>
          <button
            class="cursor-pointer rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
            type="button"
            on:click={addBot}
          >
            Add Bot
          </button>
        </div>

        <div class="space-y-2">
          {#each bots as bot (bot.id)}
            <button
              class={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                selectedBot?.id === bot.id
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-[#1f1f1f] text-slate-300 hover:border-white/20"
              }`}
              type="button"
              on:click={() => selectBot(bot.id)}
            >
              <span>
                <span class="block font-medium">{bot.name || bot.id}</span>
                <span class="block text-xs text-slate-400">{bot.id}</span>
              </span>
              <span class={`text-[10px] ${bot.enabled ? "text-emerald-300" : "text-slate-500"}`}>
                {bot.enabled ? "ON" : "OFF"}
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if selectedBot}
        <form class="space-y-4" on:submit|preventDefault={save}>
          <section class="space-y-4 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-slate-200">Bot Configuration</h2>
              <button
                class="cursor-pointer rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                type="button"
                on:click={() => removeBot(selectedBot.id)}
              >
                Remove Bot
              </button>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Bot ID</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  bind:value={selectedBot.id}
                  placeholder="marketing-bot"
                  disabled={!selectedBot.isNew}
                />
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Bot Name</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedBot.name}
                  placeholder="Marketing Bot"
                />
              </label>
            </div>
            {#if !selectedBot.isNew}
              <p class="text-xs text-slate-500">
                Bot ID is locked after creation to keep workspace paths and references stable.
              </p>
            {/if}

            <label class="flex items-center gap-3 text-sm text-slate-300">
              <input bind:checked={selectedBot.enabled} type="checkbox" />
              Enable this plugin instance
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Linked Agent</span>
              <select
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedBot.agentId}
              >
                <option value="">No agent (global fallback only)</option>
                {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                  <option value={agent.id}>{agent.name || agent.id}</option>
                {/each}
              </select>
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Bot token</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedBot.token}
                type="password"
                placeholder="123456:ABCDEF..."
              />
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Allowed chat IDs (comma-separated)</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedBot.allowedChatIds}
                placeholder="123456789,-1001234567890"
              />
            </label>
          </section>

          <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div>
              <h3 class="text-sm font-semibold text-slate-200">Bot Markdown Overrides</h3>
              <p class="mt-1 text-xs text-slate-400">
                Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
              </p>
            </div>

            {#each botFileNames as fileName}
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">{fileName}</span>
                <textarea
                  class="min-h-[160px] rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedBot.profileFiles[fileName]}
                  placeholder={`Edit ${fileName} here`}
                ></textarea>
              </label>
            {/each}
          </section>

          <button
            class="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
            type="submit"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Telegram Settings"}
          </button>

          {#if message}
            <p class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {message}
            </p>
          {/if}
          {#if error}
            <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          {/if}
        </form>
      {/if}
    </div>
  {/if}
</div>
